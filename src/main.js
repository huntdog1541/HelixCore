/**
 * HelixCore OS — Entry Point
 * Boots the application and wires all modules together.
 */
import { App } from './ui/App.js';

window.addEventListener('load', () => {
    const app = new App(document.getElementById('app'));
    app.boot();
});