$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path

function Replace-Exact([string]$path, [string]$old, [string]$new) {
  $full = Join-Path $root $path
  if (!(Test-Path $full)) { throw "Файл не найден: $path" }
  $text = [IO.File]::ReadAllText($full)
  if (!$text.Contains($old)) { throw "Не найден ожидаемый фрагмент в $path. Патч рассчитан на Eldervale 1.1.3." }
  [IO.File]::WriteAllText($full, $text.Replace($old, $new), [Text.UTF8Encoding]::new($false))
}

function Replace-Regex([string]$path, [string]$pattern, [string]$replacement) {
  $full = Join-Path $root $path
  if (!(Test-Path $full)) { throw "Файл не найден: $path" }
  $text = [IO.File]::ReadAllText($full)
  $next = [regex]::Replace($text, $pattern, $replacement, [Text.RegularExpressions.RegexOptions]::Singleline)
  if ($next -eq $text) { throw "Не найден ожидаемый блок в $path. Патч рассчитан на Eldervale 1.1.3." }
  [IO.File]::WriteAllText($full, $next, [Text.UTF8Encoding]::new($false))
}

# 1. Обновление не может прервать генерацию, загрузку или сохранение.
Replace-Exact 'src/App.tsx' `
"    if (booting || !updateState.updateRequired) return;" `
"    if (booting || simulating || !updateState.updateRequired) return;"
Replace-Exact 'src/App.tsx' `
"  }, [booting, updateState.updateRequired, updateState.remoteVersion]);" `
"  }, [booting, simulating, updateState.updateRequired, updateState.remoteVersion]);"

# 2. После генерации показываются реальные этапы; список слотов больше не держит открытие мира.
$oldGenerate = @'
      const result = await generateWorldInBackground(config, setProgress);
      if (!result.world) throw new Error('Генератор не вернул созданный мир');
      const receivedAt = performance.now();
      const saveStarted = performance.now();
      const createdSlot = await createWorldSlot(result.world);
      const saveMs = performance.now() - saveStarted;
      setActiveSlotId(createdSlot.slotId);
      setStorageProfile(createdSlot.profile);
      await refreshStorage(createdSlot.slotId);
'@
$newGenerate = @'
      const result = await generateWorldInBackground(config, setProgress);
      if (!result.world) throw new Error('Генератор не вернул созданный мир');
      const receivedAt = performance.now();
      setLoadingText('Сохраняем созданный мир');
      setProgress({ operation: 'сохранение', phase: 'Разделяем мир на безопасные части', completed: 0, total: 3, percent: 0, elapsedMs: 0 });
      const saveStarted = performance.now();
      const createdSlot = await createWorldSlot(result.world);
      const saveMs = performance.now() - saveStarted;
      setProgress({ operation: 'сохранение', phase: 'Подготавливаем интерфейс', completed: 2, total: 3, percent: 98, elapsedMs: saveMs });
      setActiveSlotId(createdSlot.slotId);
      setStorageProfile(createdSlot.profile);
'@
Replace-Exact 'src/App.tsx' $oldGenerate $newGenerate
$oldGenerateTail = @'
      setPerformanceProfile(profile);
      setWorld(result.world);
      setEntityStack([]);
      setSetupOpen(false);
      setView('map');
      setLocalPosition(undefined);
'@
$newGenerateTail = @'
      setPerformanceProfile(profile);
      setWorld(result.world);
      setEntityStack([]);
      setSetupOpen(false);
      setView('map');
      setLocalPosition(undefined);
      setProgress({ operation: 'сохранение', phase: 'Мир открыт', completed: 3, total: 3, percent: 100, elapsedMs: performance.now() - saveStarted });
      void refreshStorage(createdSlot.slotId);
'@
Replace-Exact 'src/App.tsx' $oldGenerateTail $newGenerateTail

# 3. Worker не держит вторую полную копию мира во время первого сохранения.
Replace-Exact 'src/lib/worldWorkerClient.ts' `
"      if (request.action === 'initialize' || request.action === 'generate') workerHasWorld = true;" `
"      if (request.action === 'initialize') workerHasWorld = true;`r`n      if (request.action === 'generate') workerHasWorld = false;"

$oldWorkerEnd = @'
  engine = createSimulationEngine(world);
  const totalMs = performance.now() - startedAt;
'@
$newWorkerEnd = @'
  post({ id: message.id, type: 'progress', progress: progressMessage('генерация', 'Индексируем созданный мир', 95, 100, startedAt) });
  engine = createSimulationEngine(world);
  const totalMs = performance.now() - startedAt;
'@
Replace-Exact 'src/workers/world.worker.ts' $oldWorkerEnd $newWorkerEnd
Replace-Exact 'src/workers/world.worker.ts' `
"  post({ id: message.id, type: 'complete', world, profile });" `
"  post({ id: message.id, type: 'progress', progress: progressMessage('генерация', 'Передаём мир приложению', 98, 100, startedAt) });`r`n  post({ id: message.id, type: 'complete', world, profile });`r`n  // Главный поток уже получил собственную structured-clone копию. Не держим`r`n  // второй полный мир и его индексы во время тяжёлого первого сохранения.`r`n  engine = undefined;"

# Генератор больше не сообщает 100%, пока мир ещё индексируется и передаётся.
Replace-Exact 'src/workers/world.worker.ts' `
"    post({ id: message.id, type: 'progress', progress: progressMessage(operation, phase, completed, total, startedAt, { detail }) });" `
"    const capped = Math.min(94, completed / Math.max(1, total) * 94);`r`n    post({ id: message.id, type: 'progress', progress: progressMessage(operation, phase, capped, 100, startedAt, { detail }) });"
Replace-Exact 'src/lib/worldWorkerClient.ts' `
"      onProgress?.({ operation, phase, completed, total, percent: completed / total * 100, elapsedMs, etaMs: completed ? elapsedMs / completed * (total - completed) : undefined, detail });" `
"      const capped = Math.min(94, completed / Math.max(1, total) * 94);`r`n      onProgress?.({ operation, phase, completed: capped, total: 100, percent: capped, elapsedMs, etaMs: completed ? elapsedMs / completed * (total - completed) : undefined, detail });"

# 4. Убираем дорогое создание Blob для каждой сущности при сохранении.
Replace-Exact 'src/lib/worldStorage.ts' `
"  return { key: `${slotId}:${collection}:${order}`, slotId, collection, order, fingerprint: hashString(serialized), byteSize: new Blob([serialized]).size, data };" `
"  return { key: `${slotId}:${collection}:${order}`, slotId, collection, order, fingerprint: hashString(serialized), byteSize: serialized.length * 2, data };"

# 5. Загрузка IndexedDB идёт курсором: нет временного огромного массива getAll().
$cursorBlock = @'
async function loadPartitionedWorld(slotId: string): Promise<WorldState | undefined> {
  const db = await openDatabase();
  const coreTransaction = db.transaction(CORE_STORE, 'readonly');
  const core = await requestValue(coreTransaction.objectStore(CORE_STORE).get(slotId) as IDBRequest<StoredCore | undefined>);
  await transactionDone(coreTransaction);
  if (!core) { db.close(); return undefined; }

  const collections: Record<string, unknown[]> = Object.fromEntries(entityCollections.map(name => [name, []]));
  const tileChunks: { order: number; data: WorldState['tiles'] }[] = [];
  const fingerprints = new Map<string, string>();
  const transaction = db.transaction(RECORD_STORE, 'readonly');
  const index = transaction.objectStore(RECORD_STORE).index('slotId');
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(slotId));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      const record = cursor.value as StoredRecord;
      fingerprints.set(record.key, record.fingerprint);
      if (record.collection === 'tiles') tileChunks.push({ order: Number(record.order), data: record.data as WorldState['tiles'] });
      else collections[record.collection]!.push(record.data);
      cursor.continue();
    };
  });
  await transactionDone(transaction);
  db.close();

  for (const name of entityCollections) collections[name]!.sort((a: any, b: any) => entityOrder(a) - entityOrder(b));
  tileChunks.sort((a, b) => a.order - b.order);
  fingerprintCache.set(slotId, fingerprints);
  return migrateWorld({ ...core.core, tiles: tileChunks.flatMap(chunk => chunk.data), ...collections });
}

'@
Replace-Regex 'src/lib/worldStorage.ts' 'async function loadPartitionedWorld\(slotId: string\): Promise<WorldState \| undefined> \{.*?\n\}\n\n(?=export async function createWorldSlot)' $cursorBlock

# 6. Природный источник раскладывается по множеству пятен и клеток.
$oldIngredientLoop = @'
  for (const ingredient of world.ingredients.filter(item => item.abundance > 0 && item.x === tile.x && item.y === tile.y)) {
    const point = randomWalkable(cells, width, height, new RNG(`${world.config.seed}:ингредиент:${ingredient.id}:${tile.x}:${tile.y}`), 4);
    markers.push({ id: `resource-${ingredient.id}`, x: point.x, y: point.y, kind: 'resource', label: ingredient.name, refs: [{ kind: 'ingredient', id: ingredient.id }], count: Math.round(ingredient.abundance), detail: `${ingredient.kind} · запас ${Math.round(ingredient.abundance)}` });
    const cell = cells[point.y * width + point.x];
    if (cell && !cell.feature) cell.feature = ingredient.kind === 'гриб' ? 'mushroom' : ingredient.kind === 'растение' ? 'herb' : 'rock';
  }
'@
$newIngredientLoop = @'
  for (const ingredient of world.ingredients.filter(item => item.abundance > 0 && item.x === tile.x && item.y === tile.y)) {
    const spreadRng = new RNG(`${world.config.seed}:ареал-ингредиента:${ingredient.id}:${tile.x}:${tile.y}`);
    const total = Math.max(1, Math.round(ingredient.abundance));
    const patchCount = Math.max(3, Math.min(18, Math.round(Math.sqrt(total) * 1.35)));
    let remaining = total;
    for (let patchIndex = 0; patchIndex < patchCount && remaining > 0; patchIndex += 1) {
      const center = randomWalkable(cells, width, height, spreadRng, 5);
      const patchesLeft = patchCount - patchIndex;
      const amount = patchIndex === patchCount - 1 ? remaining : Math.max(1, Math.min(remaining - (patchesLeft - 1), Math.round(remaining / patchesLeft * spreadRng.int(65, 135) / 100)));
      remaining -= amount;
      const radius = ingredient.kind === 'минерал' ? spreadRng.int(1, 3) : spreadRng.int(2, 5);
      let painted = 0;
      const targetCells = Math.max(2, Math.min(amount, ingredient.kind === 'минерал' ? spreadRng.int(3, 8) : spreadRng.int(4, 12)));
      for (let attempt = 0; attempt < targetCells * 5 && painted < targetCells; attempt += 1) {
        const x = center.x + spreadRng.int(-radius, radius);
        const y = center.y + spreadRng.int(-radius, radius);
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
        const cell = cells[y * width + x];
        if (!cell || cell.blocked || cell.ground === 'water' || cell.building) continue;
        if (!cell.feature || ['bush', 'reeds', 'rock'].includes(cell.feature)) {
          cell.feature = ingredient.kind === 'гриб' ? 'mushroom' : ingredient.kind === 'растение' ? 'herb' : 'rock';
          painted += 1;
        }
      }
      markers.push({
        id: `resource-${ingredient.id}-${patchIndex}`, x: center.x, y: center.y, kind: 'resource', label: ingredient.name,
        refs: [{ kind: 'ingredient', id: ingredient.id }], count: amount,
        detail: `${ingredient.kind} · участок ${patchIndex + 1}/${patchCount} · запас ${amount}`,
      });
    }
  }
'@
Replace-Exact 'src/lib/localMap.ts' $oldIngredientLoop $newIngredientLoop

# 7. Версия.
Replace-Exact 'package.json' '"version": "1.1.3"' '"version": "1.1.4"'
Replace-Exact 'package-lock.json' '"version": "1.1.3"' '"version": "1.1.4"'
Replace-Exact 'public/sw.js' "const VERSION = '1.1.3';" "const VERSION = '1.1.4';"
Replace-Regex 'public/version.json' '"version":\s*"1\.1\.3",\s*"name":\s*"[^"]+"' "`"version`": `"1.1.4`",`r`n  `"name`": `"Стабилизация генерации и природные ареалы`""

Write-Host 'Патч 1.1.4 применён.' -ForegroundColor Green
Write-Host 'Теперь выполни: npm ci; npm run build' -ForegroundColor Cyan
