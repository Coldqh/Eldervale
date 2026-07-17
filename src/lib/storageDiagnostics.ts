export type StorageOperation =
  | 'открыть хранилище'
  | 'прочитать список миров'
  | 'прочитать мир'
  | 'сохранить мир'
  | 'прочитать снимки'
  | 'восстановить снимок';

let lastAlertKey: string | undefined;

export function reportWorldStorageFailure(operation: StorageOperation, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause || 'неизвестная ошибка');
  const error = new Error(`Не удалось ${operation}: ${detail}`);
  console.error('[Eldervale storage]', operation, cause);

  if (typeof window !== 'undefined') {
    const key = `${operation}:${detail}`;
    if (lastAlertKey !== key) {
      lastAlertKey = key;
      window.setTimeout(() => {
        window.alert(`${error.message}. Сохранённые миры не удалены. Проверь свободное место и разрешение браузера на хранение данных.`);
      }, 0);
    }
  }

  return error;
}
