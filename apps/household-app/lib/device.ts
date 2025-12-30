import { ulid } from 'ulidx';

/**
 * デバイスIDを取得または生成
 * 同じデバイスでは常に同じIDを返す
 */
export function getDeviceId(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('deviceId');
    if (stored) {
      return stored;
    }
    const newDeviceId = ulid(Date.now());
    localStorage.setItem('deviceId', newDeviceId);
    return newDeviceId;
  }

  // サーバー環境やテスト環境ではランダム生成
  return ulid(Date.now());
}
