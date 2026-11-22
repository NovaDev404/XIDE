import { useState, useEffect, useCallback } from 'react'
import { CodeEditor } from './components/CodeEditor'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
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
  Terminal,
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

type MenuDropdown = 'file' | 'edit' | 'product' | null
type ContextMenuTarget =
  | { type: 'file'; path: string; name: string }
  | { type: 'folder'; path: string; name: string; expanded?: boolean }
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
  const [newProjectError, setNewProjectError] = useState('')
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [closeDialogTarget, setCloseDialogTarget] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null)
  const [pendingProjectPath, setPendingProjectPath] = useState<string | null>(null)
  const [pendingProjectCreate, setPendingProjectCreate] = useState(false)
  const [showProjectSwitchDialog, setShowProjectSwitchDialog] = useState(false)
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [terminalOutput, setTerminalOutput] = useState<string[]>([])
  const [isTerminalRunning, setIsTerminalRunning] = useState(false)
  const [buildStatus, setBuildStatus] = useState<'idle' | 'building' | 'completed' | 'failed'>('idle')
  const [terminalInput, setTerminalInput] = useState('')

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

  const applyProject = useCallback((dirPath: string) => {
    setProjectPath(dirPath)
    setOpenTabs([])
    setActiveTab(null)
    setContextMenu(null)
    loadFileTree(dirPath)
  }, [loadFileTree])

  // Load last project on startup
  useEffect(() => {
    const loadLastProject = async () => {
      try {
        const lastPath = await invoke<string | null>('load_last_project_path')
        if (lastPath) {
          applyProject(lastPath)
        }
      } catch (e) {
        console.error('Failed to load last project:', e)
      }
    }
    loadLastProject()
  }, [applyProject])

  // Save project path whenever it changes
  useEffect(() => {
    if (projectPath) {
      invoke('save_last_project_path', { path: projectPath }).catch((e) => {
        console.error('Failed to save last project path:', e)
      })
    }
  }, [projectPath])

  // Start terminal when project is opened
  useEffect(() => {
    if (projectPath && !isTerminalRunning) {
      handleStartTerminal()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  const loadFolderChildren = useCallback(async (path: string) => {
    try {
      const entries = await invoke<any[]>('read_dir', { path })
      const children: FileNode[] = entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        kind: entry.is_dir ? 'folder' : 'file',
        expanded: false,
        selected: false,
      }))
      const updateChildren = (nodes: FileNode[]): FileNode[] =>
        nodes.map((n) =>
          n.path === path
            ? { ...n, children }
            : n.children
              ? { ...n, children: updateChildren(n.children) }
              : n
        )
      setFileTree(updateChildren)
    } catch (e) {
      console.error('Failed to load children:', e)
    }
  }, [])

  const toggleFolder = useCallback((node: FileNode) => {
    if (node.kind !== 'folder') return
    const update = (nodes: FileNode[]): FileNode[] =>
      nodes.map((n) => {
        if (n.path === node.path) {
          return { ...n, expanded: !n.expanded }
        }
        if (n.children) {
          return { ...n, children: update(n.children) }
        }
        return n
      })
    setFileTree(update)
    if (!node.expanded && (!node.children || node.children.length === 0)) {
      loadFolderChildren(node.path)
    }
  }, [loadFolderChildren])

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

  const removeTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const filtered = prev.filter((t) => t.path !== path)
      if (activeTab === path) {
        setActiveTab(filtered.length > 0 ? filtered[filtered.length - 1].path : null)
      }
      return filtered
    })
  }, [activeTab])

  const closeTab = useCallback((path: string) => {
    const tab = openTabs.find((t) => t.path === path)
    if (tab?.dirty) {
      setCloseDialogTarget(path)
      setShowCloseDialog(true)
      return
    }
    removeTab(path)
  }, [openTabs, removeTab])

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

  const confirmProjectSwitch = useCallback(async (saveFirst: boolean, dirPath?: string, create = false) => {
    const target = dirPath ?? pendingProjectPath
    const shouldCreate = dirPath ? create : pendingProjectCreate
    if (saveFirst) {
      await saveAll()
    }
    if (target) {
      if (shouldCreate) {
        await invoke('create_dir_all', { path: target })
      }
      applyProject(target)
    }
    setShowProjectSwitchDialog(false)
    setPendingProjectPath(null)
    setPendingProjectCreate(false)
  }, [pendingProjectPath, pendingProjectCreate, saveAll, applyProject])

  const requestProjectSwitch = useCallback((dirPath: string | null, create = false) => {
    if (!dirPath) return
    if (dirPath === projectPath) {
      loadFileTree(dirPath)
      return
    }
    if (openTabs.some((t) => t.dirty)) {
      setPendingProjectPath(dirPath)
      setPendingProjectCreate(create)
      setShowProjectSwitchDialog(true)
    } else {
      confirmProjectSwitch(false, dirPath, create)
    }
  }, [projectPath, openTabs, loadFileTree, confirmProjectSwitch])

  const handleNewProject = useCallback(async () => {
    // Prevent double submission
    if (isCreatingProject) return

    // Validate project name - only a-z, A-Z, 0-9, _, - allowed
    const name = newProjectName.trim()
    if (!name) {
      setNewProjectError('Project name is required')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setNewProjectError('Project name may only contain a-z, A-Z, 0-9, _, and -')
      return
    }

    setIsCreatingProject(true)
    setNewProjectError('')

    try {
      // Check if xtool is installed
      const xtoolInstalled = await invoke<boolean>('check_xtool_installed')
      if (!xtoolInstalled) {
        setNewProjectError('xtool is not installed. Please install xtool first.')
        setIsCreatingProject(false)
        return
      }

      const parentDir = await invoke<string | null>('pick_folder')
      if (!parentDir) {
        setIsCreatingProject(false)
        return
      }

      // Run xtool new
      const output = await invoke<string>('run_xtool_new', {
        projectName: name,
        parentDir,
      })

      // Wait for "Finished generating project" in output
      if (!output.includes('Finished generating project')) {
        setNewProjectError('Failed to generate project. Check xtool output.')
        setIsCreatingProject(false)
        return
      }

      // Extract project name from output to handle case changes
      const match = output.match(/Finished generating project (\S+)/)
      const finalProjectName = match ? match[1] : name

      const dirPath = `${parentDir.replace(/[/\\]+$/, '')}/${finalProjectName}`
      setShowNewProjectDialog(false)
      setNewProjectName('')
      setIsCreatingProject(false)

      // Open the generated project
      requestProjectSwitch(dirPath, false)
    } catch (e) {
      console.error('Failed to create project:', e)
      setNewProjectError(e instanceof Error ? e.message : 'Failed to create project')
      setIsCreatingProject(false)
    }
  }, [newProjectName, requestProjectSwitch, isCreatingProject])

  const handleOpenProject = useCallback(async () => {
    try {
      const dirPath = await invoke<string | null>('pick_folder')
      requestProjectSwitch(dirPath)
    } catch (e) {
      console.error('Failed to open project:', e)
    }
  }, [requestProjectSwitch])

  const handleConfirmProjectSwitch = useCallback(() => {
    confirmProjectSwitch(false)
  }, [confirmProjectSwitch])

  const handleSaveAllAndSwitch = useCallback(() => {
    confirmProjectSwitch(true)
  }, [confirmProjectSwitch])

  const handleCancelProjectSwitch = useCallback(() => {
    setShowProjectSwitchDialog(false)
    setPendingProjectPath(null)
    setPendingProjectCreate(false)
  }, [])

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
      removeTab(closeDialogTarget)
    }
    setShowCloseDialog(false)
    setCloseDialogTarget(null)
  }, [closeDialogTarget, removeTab])

  const handleSaveAndClose = useCallback(async () => {
    const tab = openTabs.find((t) => t.path === closeDialogTarget)
    if (tab) {
      await saveFile(tab)
    }
    if (closeDialogTarget) {
      removeTab(closeDialogTarget)
    }
    setShowCloseDialog(false)
    setCloseDialogTarget(null)
  }, [closeDialogTarget, openTabs, saveFile, removeTab])

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
      target: node.kind === 'folder'
        ? { type: 'folder', path: node.path, name: node.name, expanded: node.expanded }
        : { type: 'file', path: node.path, name: node.name }
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

  const handleStartTerminal = useCallback(async () => {
    if (!projectPath) return
    try {
      await invoke('start_terminal', { projectPath })
      setIsTerminalRunning(true)
    } catch (e) {
      console.error('Failed to start terminal:', e)
    }
  }, [projectPath])

  const handleStopTerminal = useCallback(async () => {
    try {
      await invoke('stop_terminal')
      setIsTerminalRunning(false)
      setBuildStatus('idle')
    } catch (e) {
      console.error('Failed to stop terminal:', e)
    }
  }, [])

  const handleSendCommand = useCallback(async () => {
    if (!terminalInput.trim()) return
    try {
      await invoke('send_terminal_command', { command: terminalInput })
      setTerminalOutput((prev) => [...prev, `$ ${terminalInput}`])
      setTerminalInput('')
    } catch (e) {
      console.error('Failed to send command:', e)
    }
  }, [terminalInput])

  const handleBuild = useCallback(async () => {
    const buildCmd = 'xtool dev build --ipa'
    setTerminalOutput((prev) => [...prev, `$ ${buildCmd}`])
    setBuildStatus('building')
    try {
      await invoke('send_terminal_command', { command: buildCmd })
    } catch (e) {
      console.error('Failed to send build command:', e)
      setBuildStatus('failed')
    }
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

  // Listen for terminal output
  useEffect(() => {
    let unlisten: (() => void) | null = null

    const setupListeners = async () => {
      try {
        unlisten = await listen('terminal-output', (event) => {
          const { line, type } = event.payload as { line: string; type: string }
          setTerminalOutput((prev) => [...prev, line])

          // Check for build completion
          if (line.includes('Wrote to') && line.includes('.ipa')) {
            setBuildStatus('completed')
            setIsTerminalRunning(false)
          }
        })

        await listen('terminal-exited', () => {
          setIsTerminalRunning(false)
          if (buildStatus === 'building') {
            setBuildStatus('failed')
          }
        })
      } catch (e) {
        console.error('Failed to setup terminal listeners:', e)
      }
    }

    setupListeners()

    return () => {
      unlisten?.()
    }
  }, [buildStatus])

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
        <div
          className="menu-item"
          onClick={() => setMenuDropdown(menuDropdown === 'product' ? null : 'product')}
        >
          Product
          {menuDropdown === 'product' && (
            <div className="menu-dropdown">
              <div className="menu-dropdown-item" onClick={handleBuild}>
                Build
              </div>
            </div>
          )}
        </div>
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
          <button
            className="toolbar-btn run-btn"
            onClick={handleBuild}
            disabled={!projectPath || !isTerminalRunning}
          >
            <Play size={14} />
          </button>
          <button
            className="toolbar-btn stop-btn"
            onClick={handleStopTerminal}
            disabled={!isTerminalRunning}
          >
            <Square size={14} />
          </button>
          <div className="separator"></div>
          <div className="scheme-selector">
            <span className="scheme-name">{projectPath ? projectPath.split(/[/\\]/).pop() : 'No Project'}</span>
          </div>
        </div>
        <div className="toolbar-center">
          <span className="build-status">
            {buildStatus === 'building' && 'Building...'}
            {buildStatus === 'completed' && 'Build Completed'}
            {buildStatus === 'failed' && 'Build Failed'}
            {buildStatus === 'idle' && (projectPath ? 'Ready' : 'No Project Open')}
          </span>
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

      {/* Terminal Panel */}
      <div className="terminal-panel">
        <div className="terminal-header">
          <span className="terminal-title">Terminal</span>
        </div>
        <div className="terminal-content">
          {terminalOutput.length === 0 && (
            <div className="terminal-empty">Terminal ready.</div>
          )}
          {terminalOutput.map((line, index) => (
            <div key={index} className="terminal-line">
              {line}
            </div>
          ))}
        </div>
        <div className="terminal-input-container">
          <span className="terminal-prompt">$</span>
          <input
            type="text"
            className="terminal-input"
            value={terminalInput}
            onChange={(e) => setTerminalInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSendCommand()
              }
            }}
            placeholder="Enter command..."
            disabled={!isTerminalRunning}
          />
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
                onChange={(e) => {
                  // Auto-convert spaces to underscores
                  const value = e.target.value.replace(/ /g, '_')
                  setNewProjectName(value)
                  setNewProjectError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleNewProject()
                  }
                }}
                disabled={isCreatingProject}
                autoFocus
              />
              <div className="hint-text">Only a-z, A-Z, 0-9, _, and - are allowed</div>
              {newProjectError && <div className="error-text">{newProjectError}</div>}
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setShowNewProjectDialog(false)} disabled={isCreatingProject}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleNewProject} disabled={isCreatingProject}>
                {isCreatingProject ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Switch Dialog */}
      {showProjectSwitchDialog && (
        <div className="dialog-overlay" onClick={handleCancelProjectSwitch}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Unsaved Changes</h3>
              <button className="dialog-close" onClick={handleCancelProjectSwitch}>
                <X size={16} />
              </button>
            </div>
            <div className="dialog-body">
              <p>You have unsaved changes. Switching projects will close all open files.</p>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={handleCancelProjectSwitch}>
                Cancel
              </button>
              <button className="btn-secondary" onClick={handleConfirmProjectSwitch}>
                Discard &amp; Switch
              </button>
              <button className="btn-primary" onClick={handleSaveAllAndSwitch}>
                Save All &amp; Switch
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
              <p>This file has unsaved changes. What would you like to do?</p>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={handleCancelClose}>
                Cancel
              </button>
              <button className="btn-secondary" onClick={handleConfirmClose}>
                Don't Save
              </button>
              <button className="btn-primary" onClick={handleSaveAndClose}>
                Save
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
                {(contextMenu.target as { expanded?: boolean }).expanded ? 'Collapse' : 'Expand'}
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
