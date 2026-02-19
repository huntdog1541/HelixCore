/**
 * Editor — CodeMirror 6 based code editor component
 *
 * Features:
 *   - Syntax highlighting for C, Assembly, Shell
 *   - Line numbers, bracket matching, auto-indent
 *   - File switching with per-file state preservation
 *   - Emits 'cursor' and 'dirty' events for the status bar / sidebar
 */

import { EditorState }          from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { cpp }   from '@codemirror/lang-cpp';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { gas }   from '@codemirror/legacy-modes/mode/gas';
import { oneDark } from '@codemirror/theme-one-dark';

import { DEMO_FILES }   from './demoFiles.js';
import { EventEmitter } from '../utils/EventEmitter.js';

/** Map file extension → CodeMirror language extension */
function langExtension(filename) {
    const ext = filename.split('.').pop();
    if (ext === 'c' || ext === 'cpp' || ext === 'h') return cpp();
    if (ext === 'asm' || ext === 's')                return StreamLanguage.define(gas);
    if (ext === 'sh')                                return StreamLanguage.define(shell);
    return [];
}

/** HelixCore CodeMirror theme — overrides one-dark to match phosphor palette */
const helixTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: '13px',
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        backgroundColor: '#101820',
    },
    '.cm-scroller':          { overflow: 'auto', lineHeight: '1.6' },
    '.cm-content':           { caretColor: '#00ff88', padding: '12px 0' },
    '.cm-line':              { padding: '0 16px' },
    '.cm-cursor':            { borderLeftColor: '#00ff88', borderLeftWidth: '2px' },
    '.cm-activeLine':        { backgroundColor: 'rgba(0,255,136,0.04)' },
    '.cm-activeLineGutter':  { backgroundColor: 'rgba(0,255,136,0.06)', color: '#00b860' },
    '.cm-gutters':           { backgroundColor: '#0c1117', borderRight: '1px solid #1c2d3f', color: '#2d4a38' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '36px' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(0,255,136,0.18) !important' },
    '.cm-matchingBracket':   { backgroundColor: 'rgba(255,176,0,0.2)', outline: '1px solid #ffb000' },
    '.cm-searchMatch':       { backgroundColor: 'rgba(0,212,255,0.2)', outline: '1px solid #00d4ff' },
}, { dark: true });

export class Editor extends EventEmitter {
    constructor(containerEl) {
        super();
        this.container   = containerEl;
        this.currentFile = 'main.c';
        this.files       = { ...DEMO_FILES };  // filename → source string
        this.dirty       = new Set();
        this._view       = null;               // CodeMirror EditorView instance
    }

    mount() {
        this.container.innerHTML = `
      <div class="editor-tabs" id="editor-tabs">
        <div class="editor-tab active">
          <span id="tab-filename">main.c</span>
          <span class="tab-dot" id="tab-dirty"></span>
        </div>
      </div>
      <div id="cm-host" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
    `;

        this._createView(this.currentFile);
        return this;
    }

    /** Switch to a different file, preserving the current file's content */
    loadFile(name) {
        if (this._view) {
            this.files[this.currentFile] = this._view.state.doc.toString();
        }

        this.currentFile = name;

        // Rebuild the view with the new language extension
        this._createView(name);

        const fn = document.getElementById('tab-filename');
        if (fn) fn.textContent = name;

        const dot = document.getElementById('tab-dirty');
        if (dot) dot.classList.toggle('dirty', this.dirty.has(name));

        this.emit('filechange', { name, dirty: this.dirty.has(name) });
    }

    getCode()  { return this._view?.state.doc.toString() ?? ''; }
    getFile()  { return this.currentFile; }
    isDirty(f) { return this.dirty.has(f ?? this.currentFile); }

    markClean(f = this.currentFile) {
        this.dirty.delete(f);
        const dot = document.getElementById('tab-dirty');
        if (dot) dot.classList.remove('dirty');
        this.emit('dirty', { name: f, dirty: false });
    }

    /** Build (or rebuild) the CodeMirror EditorView for a given file */
    _createView(filename) {
        const host = document.getElementById('cm-host');

        // Destroy previous view if switching files
        if (this._view) {
            this._view.destroy();
            this._view = null;
        }

        const updateListener = EditorView.updateListener.of(update => {
            if (update.docChanged) {
                this.files[this.currentFile] = update.state.doc.toString();
                this.dirty.add(this.currentFile);
                const dot = document.getElementById('tab-dirty');
                if (dot) dot.classList.add('dirty');
                this.emit('dirty', { name: this.currentFile, dirty: true });
            }
            if (update.selectionSet) {
                const pos   = update.state.selection.main.head;
                const line  = update.state.doc.lineAt(pos);
                this.emit('cursor', { line: line.number, col: pos - line.from + 1 });
            }
        });

        const state = EditorState.create({
            doc: this.files[filename] ?? '',
            extensions: [
                // Language
                langExtension(filename),
                // Theme
                oneDark,
                helixTheme,
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                // UI
                lineNumbers(),
                highlightActiveLine(),
                highlightActiveLineGutter(),
                highlightSelectionMatches(),
                bracketMatching(),
                closeBrackets(),
                indentOnInput(),
                // History & keybindings
                history(),
                keymap.of([
                    indentWithTab,
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
                ]),
                // Callbacks
                updateListener,
                // Style
                EditorView.lineWrapping,
            ],
        });

        this._view = new EditorView({ state, parent: host });
    }
}