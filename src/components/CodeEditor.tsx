import { useEffect, useRef, useState } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { EditorState, type Extension, Compartment, Transaction } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { languages } from '@codemirror/language-data'
import { LanguageDescription } from '@codemirror/language'

const xideHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--keyword)' },
  { tag: t.controlKeyword, color: 'var(--keyword)' },
  { tag: t.typeName, color: 'var(--type)' },
  { tag: t.className, color: 'var(--type)' },
  { tag: t.string, color: 'var(--string)' },
  { tag: t.number, color: 'var(--number)' },
  { tag: t.comment, color: 'var(--comment)' },
  { tag: t.lineComment, color: 'var(--comment)' },
  { tag: t.blockComment, color: 'var(--comment)' },
  { tag: t.docComment, color: 'var(--comment)' },
  { tag: t.propertyName, color: 'var(--type)' },
  { tag: t.attributeName, color: 'var(--keyword)' },
])

const xideTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--code-text)',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-content': {
    fontFamily: "'SF Mono', 'Monaco', 'Menlo', monospace",
    caretColor: 'var(--code-text)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--line-number)',
    border: 'none',
    borderRight: '1px solid var(--border-color)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--code-text)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--file-selected)',
  },
  '.cm-selectionMatch': { backgroundColor: 'transparent' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-text)' },
  '.cm-panels': { backgroundColor: 'var(--editor-bg)', color: 'var(--code-text)' },
  '.cm-searchMatch': { backgroundColor: 'transparent', outline: '1px solid var(--file-selected)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--file-selected)' },
})

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  onCursor?: (line: number, col: number) => void
  extensions?: Extension[]
  filePath?: string
  onContextMenu?: (e: React.MouseEvent) => void
}

export function CodeEditor({ value, onChange, onCursor, extensions = [], filePath, onContextMenu }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const callbacksRef = useRef({ onChange, onCursor })
  const languageCompartment = useRef(new Compartment())
  const [languageExtension, setLanguageExtension] = useState<Extension[]>([])
  callbacksRef.current = { onChange, onCursor }

  useEffect(() => {
    let cancelled = false
    const loadLanguage = async () => {
      console.log('Loading language for file:', filePath)
      if (!filePath) {
        setLanguageExtension([])
        return
      }
      const description = LanguageDescription.matchFilename(languages, filePath)
      console.log('Language description:', description)
      if (!description) {
        setLanguageExtension([])
        return
      }
      try {
        const support = await description.load()
        console.log('Language support loaded:', support)
        if (!cancelled) {
          setLanguageExtension([support.extension])
        }
      } catch (err) {
        console.error('Failed to load language support:', err)
        if (!cancelled) {
          setLanguageExtension([])
        }
      }
    }
    loadLanguage()
    return () => {
      cancelled = true
    }
  }, [filePath])

  useEffect(() => {
    console.log('Creating editor with languageExtension:', languageExtension)
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageCompartment.current.of(languageExtension),
          xideTheme,
          syntaxHighlighting(xideHighlight),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacksRef.current.onChange?.(update.state.doc.toString())
            }
            if (update.docChanged || update.selectionSet) {
              const pos = update.state.selection.main.head
              const line = update.state.doc.lineAt(pos)
              callbacksRef.current.onCursor?.(line.number, pos - line.from + 1)
            }
          }),
          ...extensions,
        ],
      }),
    })
    viewRef.current = view
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: languageCompartment.current.reconfigure(languageExtension),
    })
  }, [languageExtension])

  const prevFilePathRef = useRef<string | undefined>()
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (filePath !== prevFilePathRef.current) {
      prevFilePathRef.current = filePath
      const current = view.state.doc.toString()
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: [Transaction.addToHistory.of(false)],
      })
    } else {
      const current = view.state.doc.toString()
      if (value !== current) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
        })
      }
    }
  }, [value, filePath])

  return <div ref={hostRef} className="code-editor" onContextMenu={(e) => {
    e.preventDefault()
    onContextMenu?.(e)
  }} />
}
