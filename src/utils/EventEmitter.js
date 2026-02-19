/** Minimal EventEmitter for inter-component communication */
export class EventEmitter {
  constructor() { this._listeners = {}; }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  off(event, fn) {
    this._listeners[event] = (this._listeners[event] ?? []).filter(f => f !== fn);
    return this;
  }

  emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }
}