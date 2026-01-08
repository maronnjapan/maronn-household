const STORAGE_KEY = 'hand-preference';
type HandPreference = 'right' | 'left';

export function getHandPreference(): HandPreference {
  if (typeof window === 'undefined') return 'right';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'left' ? 'left' : 'right';
}

export function setHandPreference(preference: HandPreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
  location.reload();
}

export function useHandPreference() {
  const preference = getHandPreference();

  return {
    preference,
    setPreference: setHandPreference,
    isLeftHanded: preference === 'left',
  };
}
