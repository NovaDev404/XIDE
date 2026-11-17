import { useState, useEffect, useCallback } from 'react'
import { CodeEditor } from './components/CodeEditor'
import { invoke } from '@tauri-apps/api/core'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Moon,
  Play,
  Search,
  Settings,
  Square,
  Sun,
  X,
  Plus,
} from 'lucide-react'
import './App.css'

type FileNode = {
  name: string
  path: string
  kind: 'folder' | 'file'
  expanded?: boolean
  selected?: boolean
  children?: FileNode[]
}

type OpenTab = {
  name: string
  path: string
  content: string
  dirty: boolean
}

type MenuDropdown = 'file' | 'edit' | null
type ContextMenuTarget = 
  | { type: 'file'; path: string; name: string }
  | { type: 'folder'; path: string; name: string }
  | { type: 'editor' }
  | null

function App() {
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [menuDropdown, setMenuDropdown] = useState<MenuDropdown>(null)
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [closeDialogTarget, setCloseDialogTarget] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null)

  const loadFileTree = useCallback(async (path: string) => {
    try {
      const entries = await invoke<any[]>('read_dir', { path })
      const nodes: FileNode[] = entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        kind: entry.is_dir ? 'folder' : 'file',
        expanded: false,
        selected: false,
      }))
      setFileTree(nodes)
    } catch (e) {
      console.error('Failed to load file tree:', e)
    }
  }, [])

  const toggleFolder = useCallback((node: FileNode) => {
    if (node.kind !== 'folder') return
    const toggleNode = (nodes: FileNode[]): FileNode[] => {
      return nodes.map((n) => {
        if (n.path === node.path) {
          const updated = { ...n, expanded: !n.expanded }
          if (updated.expanded && (!n.children || n.children.length === 0)) {
            loadFileTree(n.path).then(() => {
              const loadChildren = async () => {
                try {
                  const entries = await invoke<any[]>('read_dir', { path: n.path })
                  const children: FileNode[] = entries.map((entry) => ({
                    name: entry.name,
                    path: entry.path,
                    kind: entry.is_dir ? 'folder' : 'file',
                    expanded: false,
                    selected: false,
                  }))
                  setFileTree((prev) => {
                    const updateChildren = (nodes: FileNode[]): FileNode[] => {
                      return nodes.map((nn) => {
                        if (nn.path === n.path) {
                          return { ...nn, children }
                        }
                        if (nn.children) {
                          return { ...nn, children: updateChildren(nn.children) }
                        }
                        return nn
                      })
                    }
                    return updateChildren(prev)
                  })
                } catch (e) {
                  console.error('Failed to load children:', e)
                }
              }
              loadChildren()
            })
          }
          return updated
        }
        if (n.children) {
          return { ...n, children: toggleNode(n.children) }
        }
        return n
      })
    }
    setFileTree(toggleNode)
  }, [loadFileTree])

  const openFile = useCallback(async (path: string) => {
    try {
      const content = await invoke<string>('read_file', { path })
      const existingTab = openTabs.find((t) => t.path === path)
      if (existingTab) {
        setActiveTab(path)
        return
      }
      const name = path.split(/[/\\]/).pop() || path
      const newTab: OpenTab = { name, path, content, dirty: false }
      setOpenTabs((prev) => [...prev, newTab])
      setActiveTab(path)
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }, [openTabs])

  const closeTab = useCallback((path: string) => {
    const tab = openTabs.find((t) => t.path === path)
    if (tab?.dirty) {
      setCloseDialogTarget(path)
      setShowCloseDialog(true)
      return
    }
    setOpenTabs((prev) => {
      const filtered = prev.filter((t) => t.path !== path)
      if (activeTab === path) {
        setActiveTab(filtered.length > 0 ? filtered[filtered.length - 1].path : null)
      }
      return filtered
    })
  }, [openTabs, activeTab])

  const saveFile = useCallback(async (tab: OpenTab) => {
    try {
      await invoke('write_file', { path: tab.path, contents: tab.content })
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === tab.path ? { ...t, dirty: false } : t))
      )
    } catch (e) {
      console.error('Failed to save file:', e)
    }
  }, [])

  const saveFileAs = useCallback(async (tab: OpenTab) => {
    try {
      const newPath = await invoke<string | null>('pick_save_file', {
        defaultName: tab.name,
        directory: projectPath || null,
      })
      if (newPath) {
        await invoke('write_file', { path: newPath, contents: tab.content })
        const name = newPath.split(/[/\\]/).pop() || newPath
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.path === tab.path ? { ...t, path: newPath, name, dirty: false } : t
          )
        )
        if (activeTab === tab.path) {
          setActiveTab(newPath)
        }
      }
    } catch (e) {
      console.error('Failed to save file as:', e)
    }
  }, [activeTab, projectPath])

  const saveAll = useCallback(async () => {
    for (const tab of openTabs) {
      if (tab.dirty) {
        await saveFile(tab)
      }
    }
  }, [openTabs, saveFile])

  const handleNewProject = useCallback(async () => {
    if (!newProjectName.trim()) return
    try {
      const dirPath = await invoke<string | null>('pick_save_file', {
        defaultName: newProjectName,
        directory: null,
      })
      if (dirPath) {
        await invoke('create_dir_all', { path: dirPath })
        setProjectPath(dirPath)
        await loadFileTree(dirPath)
        setShowNewProjectDialog(false)
        setNewProjectName('')
      }
    } catch (e) {
      console.error('Failed to create project:', e)
    }
  }, [newProjectName, loadFileTree])

  const handleOpenProject = useCallback(async () => {
    try {
      const dirPath = await invoke<string | null>('pick_folder')
      if (dirPath) {
        setProjectPath(dirPath)
        await loadFileTree(dirPath)
      }
    } catch (e) {
      console.error('Failed to open project:', e)
    }
  }, [loadFileTree])

  const handleNewFile = useCallback(async () => {
    if (!projectPath) {
      return
    }
    try {
      const filePath = await invoke<string | null>('pick_save_file', {
        defaultName: 'untitled',
        directory: projectPath,
      })
      if (filePath) {
        await invoke('write_file', { path: filePath, contents: '' })
        await loadFileTree(projectPath)
        await openFile(filePath)
      }
    } catch (e) {
      console.error('Failed to create new file:', e)
    }
  }, [projectPath, loadFileTree, openFile])

  const handleOpenFile = useCallback(async () => {
    try {
      const filePath = await invoke<string | null>('pick_open_file', {
        directory: projectPath || null,
      })
      if (filePath) {
        await openFile(filePath)
      }
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }, [projectPath, openFile])

  const handleCloseEditor = useCallback(() => {
    if (activeTab) {
      closeTab(activeTab)
    }
  }, [activeTab, closeTab])

  const handleConfirmClose = useCallback(() => {
    if (closeDialogTarget) {
      setOpenTabs((prev) => {
        const filtered = prev.filter((t) => t.path !== closeDialogTarget)
        if (activeTab === closeDialogTarget) {
          setActiveTab(filtered.length > 0 ? filtered[filtered.length - 1].path : null)
        }
        return filtered
      })
    }
    setShowCloseDialog(false)
    setCloseDialogTarget(null)
  }, [closeDialogTarget, activeTab])

  const handleCancelClose = useCallback(() => {
    setShowCloseDialog(false)
    setCloseDialogTarget(null)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: { type: node.kind, path: node.path, name: node.name }
    })
  }, [])

  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: { type: 'editor' }
    })
  }, [])

  const handleGlobalContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: { type: 'editor' }
    })
  }, [])

  const handleDeleteFile = useCallback(async (path: string) => {
    try {
      await invoke('remove_file', { path })
      await loadFileTree(projectPath || '')
      setOpenTabs((prev) => prev.filter((t) => t.path !== path))
      if (activeTab === path) {
        setActiveTab(null)
      }
    } catch (e) {
      console.error('Failed to delete file:', e)
    }
    setContextMenu(null)
  }, [projectPath, loadFileTree, activeTab])

  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [renameDialogTarget, setRenameDialogTarget] = useState<{ path: string; name: string } | null>(null)
  const [newFileName, setNewFileName] = useState('')

  const handleRenameFile = useCallback(async (path: string, name: string) => {
    setRenameDialogTarget({ path, name })
    setNewFileName(name)
    setShowRenameDialog(true)
    setContextMenu(null)
  }, [])

  const handleConfirmRename = useCallback(async () => {
    if (renameDialogTarget && newFileName.trim() && newFileName !== renameDialogTarget.name) {
      try {
        const newPath = renameDialogTarget.path.replace(/[^/\\]+$/, newFileName)
        await invoke('rename_file', { oldPath: renameDialogTarget.path, newPath })
        await loadFileTree(projectPath || '')
        setOpenTabs((prev) =>
          prev.map((t) => (t.path === renameDialogTarget.path ? { ...t, path: newPath, name: newFileName } : t))
        )
        if (activeTab === renameDialogTarget.path) {
          setActiveTab(newPath)
        }
      } catch (e) {
        console.error('Failed to rename file:', e)
      }
    }
    setShowRenameDialog(false)
    setRenameDialogTarget(null)
    setNewFileName('')
  }, [renameDialogTarget, newFileName, projectPath, loadFileTree, activeTab])

  const handleCancelRename = useCallback(() => {
    setShowRenameDialog(false)
    setRenameDialogTarget(null)
    setNewFileName('')
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        const tab = openTabs.find((t) => t.path === activeTab)
        if (tab) {
          saveFile(tab)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, openTabs, saveFile])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.menu-bar')) {
        setMenuDropdown(null)
      }
      setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  const activeTabData = openTabs.find((t) => t.path === activeTab)

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className={`file-item${node.kind === 'folder' ? ' folder' : ''}${node.selected ? ' selected' : ''}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => {
            if (node.kind === 'folder') {
              toggleFolder(node)
            } else {
              openFile(node.path)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            handleContextMenu(e, node)
          }}
        >
          <span className="file-icon">
            {node.kind === 'folder' ? (
              node.expanded ? <FolderOpen size={14} /> : <Folder size={14} />
            ) : (
              <FileText size={14} />
            )}
          </span>
          <span className="file-name">{node.name}</span>
        </div>
        {node.expanded && node.children && renderFileTree(node.children, depth + 1)}
      </div>
    ))
  }

  return (
    <div className={`xide ${isDarkMode ? 'dark' : 'light'}`} onContextMenu={handleGlobalContextMenu}>
      {/* Menu Bar */}
      <div className="menu-bar">
        <div
          className="menu-item"
          onClick={() => setMenuDropdown(menuDropdown === 'file' ? null : 'file')}
        >
          File
          {menuDropdown === 'file' && (
            <div className="menu-dropdown">
              <div className="menu-dropdown-item" onClick={() => setShowNewProjectDialog(true)}>
                New Project
              </div>
              <div className="menu-dropdown-item" onClick={handleOpenProject}>
                Open Project
              </div>
              <div className="menu-dropdown-separator" />
              <div className="menu-dropdown-item" onClick={handleNewFile}>
                New File
              </div>
              <div className="menu-dropdown-item" onClick={handleOpenFile}>
                Open File
              </div>
              <div className="menu-dropdown-separator" />
              <div className="menu-dropdown-item" onClick={() => activeTabData && saveFile(activeTabData)}>
                Save
              </div>
              <div className="menu-dropdown-item" onClick={() => activeTabData && saveFileAs(activeTabData)}>
                Save As
              </div>
              <div className="menu-dropdown-item" onClick={saveAll}>
                Save All
              </div>
              <div className="menu-dropdown-separator" />
              <div className="menu-dropdown-item" onClick={handleCloseEditor}>
                Close Editor
              </div>
            </div>
          )}
        </div>
        <div
          className="menu-item"
          onClick={() => setMenuDropdown(menuDropdown === 'edit' ? null : 'edit')}
        >
          Edit
          {menuDropdown === 'edit' && (
            <div className="menu-dropdown">
              <div className="menu-dropdown-item" onClick={handleNewFile}>
                New File
              </div>
              <div className="menu-dropdown-item" onClick={handleOpenFile}>
                Open File
              </div>
              <div className="menu-dropdown-separator" />
              <div className="menu-dropdown-item" onClick={() => activeTabData && saveFile(activeTabData)}>
                Save
              </div>
              <div className="menu-dropdown-item" onClick={() => activeTabData && saveFileAs(activeTabData)}>
                Save As
              </div>
              <div className="menu-dropdown-item" onClick={saveAll}>
                Save All
              </div>
              <div className="menu-dropdown-separator" />
              <div className="menu-dropdown-item" onClick={handleCloseEditor}>
                Close Editor
              </div>
            </div>
          )}
        </div>
        <div className="menu-item">View</div>
        <div className="menu-item">Find</div>
        <div className="menu-item">Navigate</div>
        <div className="menu-item">Editor</div>
        <div className="menu-item">Product</div>
        <div className="menu-item">Debug</div>
        <div className="menu-item">Source Control</div>
        <div className="menu-item">Window</div>
        <div className="menu-item">Help</div>
        <div className="theme-toggle" onClick={() => { setIsDarkMode(!isDarkMode); setMenuDropdown(null) }}>
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn"><ChevronLeft size={16} /></button>
          <button className="toolbar-btn"><ChevronRight size={16} /></button>
          <div className="separator"></div>
          <button className="toolbar-btn run-btn"><Play size={14} /></button>
          <button className="toolbar-btn stop-btn"><Square size={14} /></button>
          <div className="separator"></div>
          <div className="scheme-selector">
            <span className="scheme-name">{projectPath ? projectPath.split(/[/\\]/).pop() : 'No Project'}</span>
          </div>
        </div>
        <div className="toolbar-center">
          <span className="build-status">{projectPath ? 'Project Loaded' : 'No Project Open'}</span>
        </div>
        <div className="toolbar-right">
          <button className="toolbar-btn" onClick={handleOpenProject}><Folder size={16} /></button>
          <button className="toolbar-btn"><Search size={16} /></button>
          <button className="toolbar-btn"><Settings size={16} /></button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Left Sidebar - Navigator */}
        <div className="sidebar left-sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Navigator</span>
          </div>
          <div className="file-tree">
            {projectPath ? (
              renderFileTree(fileTree)
            ) : (
              <div className="empty-state">No project open</div>
            )}
          </div>
          <div className="sidebar-footer">
            <input type="text" placeholder="Filter" className="filter-input" />
          </div>
        </div>

        {/* Editor Area */}
        <div className="editor-area">
          <div className="editor-tabs">
            {openTabs.map((tab) => (
              <div
                key={tab.path}
                className={`tab${tab.path === activeTab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.path)}
              >
                <span>{tab.name}</span>
                {tab.dirty && <span className="dirty-indicator">●</span>}
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.path)
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {projectPath && (
              <button className="tab-new" onClick={handleNewFile}>
                <Plus size={12} />
              </button>
            )}
          </div>
          <div className="editor-content">
            {activeTabData ? (
              <CodeEditor
                value={activeTabData.content}
                onChange={(value) => {
                  setOpenTabs((prev) =>
                    prev.map((t) =>
                      t.path === activeTab ? { ...t, content: value, dirty: true } : t
                    )
                  )
                }}
                onCursor={(line, col) => setCursor({ line, col })}
                filePath={activeTabData.path}
                onContextMenu={handleEditorContextMenu}
              />
            ) : (
              <div className="empty-editor">No file open</div>
            )}
          </div>
          <div className="editor-footer">
            <span className="status-item">Line: {cursor.line}, Col: {cursor.col}</span>
            <span className="status-item">UTF-8</span>
            <span className="status-item">
              {activeTabData?.name.split('.').pop() || 'Plain'}
            </span>
          </div>
        </div>

        {/* Right Sidebar - Inspectors */}
        <div className="sidebar right-sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Inspectors</span>
          </div>
          <div className="inspector-section">
            <div className="inspector-header">File Info</div>
            <div className="inspector-content">
              {activeTabData ? (
                <>
                  <div className="inspector-item">
                    <span className="inspector-label">Name</span>
                    <span className="inspector-value">{activeTabData.name}</span>
                  </div>
                  <div className="inspector-item">
                    <span className="inspector-label">Path</span>
                    <span className="inspector-value">{activeTabData.path}</span>
                  </div>
                  <div className="inspector-item">
                    <span className="inspector-label">Modified</span>
                    <span className="inspector-value">{activeTabData.dirty ? 'Yes' : 'No'}</span>
                  </div>
                </>
              ) : (
                <div className="inspector-item">
                  <span className="inspector-label">No file selected</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New Project Dialog */}
      {showNewProjectDialog && (
        <div className="dialog-overlay" onClick={() => setShowNewProjectDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>New Project</h3>
              <button className="dialog-close" onClick={() => setShowNewProjectDialog(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="dialog-body">
              <label htmlFor="project-name">Project Name</label>
              <input
                id="project-name"
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleNewProject()
                  }
                }}
                autoFocus
              />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setShowNewProjectDialog(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleNewProject}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Tab Dialog */}
      {showCloseDialog && (
        <div className="dialog-overlay" onClick={handleCancelClose}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Unsaved Changes</h3>
              <button className="dialog-close" onClick={handleCancelClose}>
                <X size={16} />
              </button>
            </div>
            <div className="dialog-body">
              <p>This file has unsaved changes. Close anyway?</p>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={handleCancelClose}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleConfirmClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          {contextMenu.target?.type === 'file' && (
            <>
              <div className="context-menu-item" onClick={() => openFile((contextMenu.target as any).path)}>
                Open
              </div>
              <div className="context-menu-item" onClick={() => handleRenameFile((contextMenu.target as any).path, (contextMenu.target as any).name)}>
                Rename
              </div>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={() => handleDeleteFile((contextMenu.target as any).path)}>
                Delete
              </div>
            </>
          )}
          {contextMenu.target?.type === 'folder' && (
            <>
              <div className="context-menu-item" onClick={() => toggleFolder({ kind: 'folder', path: (contextMenu.target as any).path, name: (contextMenu.target as any).name })}>
                {fileTree.find(n => n.path === (contextMenu.target as any).path)?.expanded ? 'Collapse' : 'Expand'}
              </div>
              <div className="context-menu-item" onClick={() => handleRenameFile((contextMenu.target as any).path, (contextMenu.target as any).name)}>
                Rename
              </div>
            </>
          )}
          {contextMenu.target?.type === 'editor' && (
            <>
              <div className="context-menu-item" onClick={() => {
                const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })
                window.dispatchEvent(event)
              }}>
                Undo
              </div>
              <div className="context-menu-item" onClick={() => {
                const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true })
                window.dispatchEvent(event)
              }}>
                Redo
              </div>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={() => document.execCommand('cut')}>
                Cut
              </div>
              <div className="context-menu-item" onClick={() => document.execCommand('copy')}>
                Copy
              </div>
              <div className="context-menu-item" onClick={() => document.execCommand('paste')}>
                Paste
              </div>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={() => document.execCommand('selectAll')}>
                Select All
              </div>
            </>
          )}
        </div>
      )}

      {/* Rename Dialog */}
      {showRenameDialog && (
        <div className="dialog-overlay" onClick={handleCancelRename}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Rename</h3>
              <button className="dialog-close" onClick={handleCancelRename}>
                <X size={16} />
              </button>
            </div>
            <div className="dialog-body">
              <label htmlFor="file-name">New Name</label>
              <input
                id="file-name"
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmRename()
                  }
                }}
                autoFocus
              />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={handleCancelRename}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleConfirmRename}>
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
