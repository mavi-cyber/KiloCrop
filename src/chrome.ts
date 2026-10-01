// Shared page chrome: fonts, styles, icons, version and offline support.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';
import { registerSW } from 'virtual:pwa-register';
import { hydrateIcons } from './ui/icons';

export function initChrome(): void {
  hydrateIcons();
  document.querySelectorAll('.version').forEach((el) => (el.textContent = __APP_VERSION__));
  document.querySelectorAll('.year').forEach((el) => (el.textContent = String(new Date().getFullYear())));
  registerSW({ immediate: true });
}
