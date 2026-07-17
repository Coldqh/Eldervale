export type StorageOperation =
  | 'открыть хранилище'
  | 'прочитать список миров'
  | 'прочитать мир'
  | 'сохранить мир'
  | 'прочитать снимки'
  | 'восстановить снимок';

export const WORLD_STORAGE_ERROR_EVENT = 'eldervale-storage-error';

export interface StorageFailureDetail {
  operation: StorageOperation;
  message: string;
}

let lastEventKey: string | undefined;

export function reportWorldStorageFailure(operation: StorageOperation, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause || 'неизвестная ошибка');
  const error = new Error(`Не удалось ${operation}: ${detail}`);
  console.error('[Eldervale storage]', operation, cause);

  if (typeof window !== 'undefined') {
    const key = `${operation}:${detail}`;
    if (lastEventKey !== key) {
      lastEventKey = key;
      window.dispatchEvent(new CustomEvent<StorageFailureDetail>(WORLD_STORAGE_ERROR_EVENT, {
        detail: {
          operation,
          message: `${error.message}. Сохранённые миры не удалены. Проверь свободное место и разрешение браузера на хранение данных.`,
        },
      }));
    }
  }

  return error;
}
