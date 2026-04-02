import '@tiptap/extension-horizontal-rule'

import { Extension, InputRule, type ChainedCommands, type Editor, type Range } from '@tiptap/core'
import { ListItem, TaskItem, listHelpers } from '@tiptap/extension-list'
import { type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

export type SlashCommand =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'

export interface MarkdownSlashCommandOption {
  aliases: string[]
  badge: string
  command: SlashCommand
  keywords: string[]
  title: string
}

const SLASH_COMMAND_ALIASES: Record<string, SlashCommand> = {
  b: 'bold',
  bold: 'bold',
  bullet: 'bulletList',
  bullets: 'bulletList',
  checklist: 'taskList',
  check: 'taskList',
  code: 'codeBlock',
  codeblock: 'codeBlock',
  divider: 'horizontalRule',
  h1: 'heading1',
  h2: 'heading2',
  h3: 'heading3',
  h4: 'heading4',
  h5: 'heading5',
  h6: 'heading6',
  hr: 'horizontalRule',
  i: 'italic',
  italic: 'italic',
  line: 'horizontalRule',
  list: 'bulletList',
  numbered: 'orderedList',
  numberlist: 'orderedList',
  ol: 'orderedList',
  ordered: 'orderedList',
  p: 'paragraph',
  paragraph: 'paragraph',
  pre: 'codeBlock',
  quote: 'blockquote',
  rule: 'horizontalRule',
  separator: 'horizontalRule',
  strike: 'strike',
  strikethrough: 'strike',
  task: 'taskList',
  text: 'paragraph',
  todo: 'taskList',
  ul: 'bulletList'
}

const SLASH_COMMAND_INPUT_PATTERN = /^\/([a-z0-9-]+)\s$/i
const SLASH_COMMAND_ENTER_PATTERN = /^\/([a-z0-9-]+)\s*$/i
const SLASH_COMMAND_MENU_PATTERN = /^\/([a-z0-9-]*)$/i
const HORIZONTAL_RULE_MARKER_PATTERN = /^(?:---|___|\*\*\*)$/
const TASK_LINE_ENTER_PATTERN = /^\s*(?:[-+*]\s+)?\[\s*(x|X)?\]\s+(.+)$/
const OUTLINE_PARENT_NODE_NAMES = new Set(['bulletList', 'orderedList', 'taskList'])
const OUTLINE_ITEM_TYPES = ['taskItem', 'listItem'] as const
const OUTLINE_BLOCK_NODE_NAMES = new Set(['paragraph', 'heading', 'codeBlock', 'blockquote'])

type OutlineItemType = (typeof OUTLINE_ITEM_TYPES)[number]

export function isOutlineBlockNodeName(nodeName: string) {
  return OUTLINE_BLOCK_NODE_NAMES.has(nodeName)
}

export const MARKDOWN_SLASH_COMMAND_OPTIONS: MarkdownSlashCommandOption[] = [
  {
    aliases: ['text', 'paragraph', 'p'],
    badge: 'Aa',
    command: 'paragraph',
    keywords: ['body', 'plain', 'text'],
    title: 'Text'
  },
  {
    aliases: ['h1', 'heading1'],
    badge: 'H1',
    command: 'heading1',
    keywords: ['heading', 'title'],
    title: 'Heading 1'
  },
  {
    aliases: ['h2', 'heading2'],
    badge: 'H2',
    command: 'heading2',
    keywords: ['heading', 'subtitle'],
    title: 'Heading 2'
  },
  {
    aliases: ['h3', 'heading3'],
    badge: 'H3',
    command: 'heading3',
    keywords: ['heading'],
    title: 'Heading 3'
  },
  {
    aliases: ['bold', 'b'],
    badge: 'B',
    command: 'bold',
    keywords: ['strong', 'emphasis'],
    title: 'Bold'
  },
  {
    aliases: ['italic', 'i'],
    badge: 'I',
    command: 'italic',
    keywords: ['emphasis', 'slanted'],
    title: 'Italic'
  },
  {
    aliases: ['strike', 'strikethrough'],
    badge: 'S',
    command: 'strike',
    keywords: ['cross out'],
    title: 'Strikethrough'
  },
  {
    aliases: ['bullet', 'bullets', 'list', 'ul'],
    badge: '•',
    command: 'bulletList',
    keywords: ['unordered', 'bullet list'],
    title: 'Bullet List'
  },
  {
    aliases: ['ordered', 'numbered', 'ol'],
    badge: '1.',
    command: 'orderedList',
    keywords: ['number list', 'ordered list'],
    title: 'Numbered List'
  },
  {
    aliases: ['todo', 'task', 'checklist'],
    badge: '[]',
    command: 'taskList',
    keywords: ['task list', 'checkbox'],
    title: 'Todo List'
  },
  {
    aliases: ['quote'],
    badge: '❝',
    command: 'blockquote',
    keywords: ['blockquote', 'citation'],
    title: 'Quote'
  },
  {
    aliases: ['code', 'codeblock', 'pre'],
    badge: '{}',
    command: 'codeBlock',
    keywords: ['snippet', 'preformatted'],
    title: 'Code Block'
  },
  {
    aliases: ['divider', 'rule', 'hr'],
    badge: '—',
    command: 'horizontalRule',
    keywords: ['line', 'separator', 'divider'],
    title: 'Divider'
  }
]

export function resolveSlashCommand(rawCommand: string) {
  return SLASH_COMMAND_ALIASES[rawCommand.trim().toLowerCase()] ?? null
}

function taskItemNode(checked: boolean, text = '') {
  return {
    type: 'taskItem',
    attrs: { checked },
    content: [
      {
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : []
      }
    ]
  }
}

function insertTaskList(
  chain: ChainedCommands,
  range: Range,
  options: {
    checked: boolean
    createTrailingItem?: boolean
    text?: string
  }
) {
  const text = options.text ?? ''
  const content = [taskItemNode(options.checked, text)]

  if (options.createTrailingItem) {
    content.push(taskItemNode(false))
  }

  return chain
    .focus()
    .deleteRange(range)
    .insertContent({
      type: 'taskList',
      content
    })
    .command(({ tr }) => {
      const cursorPosition = options.createTrailingItem ? range.from + text.length + 7 : range.from + text.length + 3

      tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPosition)))
      tr.scrollIntoView()
      return true
    })
    .run()
}

export function runSlashCommand(command: SlashCommand, chain: ChainedCommands, range: Range) {
  const next = chain.focus().deleteRange(range)

  switch (command) {
    case 'paragraph':
      return next.setNode('paragraph').run()
    case 'heading1':
      return next.setNode('heading', { level: 1 }).run()
    case 'heading2':
      return next.setNode('heading', { level: 2 }).run()
    case 'heading3':
      return next.setNode('heading', { level: 3 }).run()
    case 'heading4':
      return next.setNode('heading', { level: 4 }).run()
    case 'heading5':
      return next.setNode('heading', { level: 5 }).run()
    case 'heading6':
      return next.setNode('heading', { level: 6 }).run()
    case 'bold':
      return next.toggleBold().run()
    case 'italic':
      return next.toggleItalic().run()
    case 'strike':
      return next.toggleStrike().run()
    case 'bulletList':
      return next.toggleList('bulletList', 'listItem').run()
    case 'orderedList':
      return next.toggleList('orderedList', 'listItem').run()
    case 'taskList':
      return insertTaskList(chain, range, { checked: false })
    case 'blockquote':
      return next.toggleWrap('blockquote').run()
    case 'codeBlock':
      return next.setNode('codeBlock').run()
    case 'horizontalRule':
      return next.setHorizontalRule().run()
  }
}

function currentShortcutRange(editor: Editor) {
  const { selection } = editor.state

  if (!selection.empty) {
    return null
  }

  const { $from } = selection

  if (!$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size) {
    return null
  }

  const text = $from.parent.textContent

  if (!text) {
    return null
  }

  return {
    range: {
      from: selection.from - text.length,
      to: selection.from
    },
    text
  }
}

export function currentSlashCommandQuery(editor: Editor) {
  const shortcut = currentShortcutRange(editor)

  if (!shortcut) {
    return null
  }

  const slashCommandMatch = shortcut.text.match(SLASH_COMMAND_MENU_PATTERN)

  if (!slashCommandMatch) {
    return null
  }

  return {
    query: (slashCommandMatch[1] ?? '').trim().toLowerCase(),
    range: shortcut.range
  }
}

function renderCollapsedAttribute(collapsed: unknown) {
  return collapsed ? { 'data-collapsed': 'true' } : {}
}

function outlineItemAttributes(parentAttributes: Record<string, unknown> = {}) {
  return {
    ...parentAttributes,
    collapsed: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-collapsed') === 'true',
      renderHTML: (attributes: { collapsed?: boolean }) =>
        renderCollapsedAttribute(attributes.collapsed)
    }
  }
}

export function currentOutlineItem(editor: Editor) {
  let itemType: OutlineItemType | null = null
  let listItemPos: ReturnType<(typeof listHelpers)['findListItemPos']> = null

  for (const candidateType of OUTLINE_ITEM_TYPES) {
    const candidatePos = listHelpers.findListItemPos(candidateType, editor.state)

    if (!candidatePos) {
      continue
    }

    if (!listItemPos || candidatePos.depth > listItemPos.depth) {
      itemType = candidateType
      listItemPos = candidatePos
    }
  }

  if (!itemType || !listItemPos) {
    return null
  }

  const itemDepth = listItemPos.depth
  const itemNode = listItemPos.$pos.node(itemDepth)
  const itemPos = listItemPos.$pos.before(itemDepth)
  const parentListDepth = itemDepth - 1
  const parentListNode = listItemPos.$pos.node(parentListDepth)
  const parentListPos = listItemPos.$pos.before(parentListDepth)
  const parentItemDepth = parentListDepth - 1
  const parentItemNode = parentItemDepth > 0 ? listItemPos.$pos.node(parentItemDepth) : null
  const parentItemType =
    parentItemNode && OUTLINE_ITEM_TYPES.includes(parentItemNode.type.name as OutlineItemType)
      ? (parentItemNode.type.name as OutlineItemType)
      : null
  const indexInParent = listItemPos.$pos.index(parentListDepth)

  return {
    indexInParent,
    itemDepth,
    itemNode,
    itemPos,
    itemType,
    parentItemDepth,
    parentItemNode,
    parentItemType,
    parentListDepth,
    parentListNode,
    parentListPos
  }
}

function currentTopLevelOutlineBlock(editor: Editor) {
  const { $from } = editor.state.selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    const parentNode = depth > 0 ? $from.node(depth - 1) : null

    if (parentNode?.type.name !== 'doc' || !isOutlineBlockNodeName(node.type.name)) {
      continue
    }

    return {
      node,
      pos: $from.before(depth)
    }
  }

  return null
}

function collectTopLevelOutlineBlocks(editor: Editor) {
  const blocks: Array<{
    node: ProseMirrorNode
    pos: number
  }> = []

  editor.state.doc.forEach((node, offset) => {
    if (!isOutlineBlockNodeName(node.type.name)) {
      return
    }

    blocks.push({
      node,
      pos: offset
    })
  })

  return blocks
}

function outlineItemHasNestedList(itemNode: { childCount: number; child: (index: number) => { type: { name: string } } }) {
  for (let index = 0; index < itemNode.childCount; index += 1) {
    if (OUTLINE_PARENT_NODE_NAMES.has(itemNode.child(index).type.name)) {
      return true
    }
  }

  return false
}

function outlineListItemType(listTypeName: string): OutlineItemType | null {
  if (listTypeName === 'taskList') {
    return 'taskItem'
  }

  if (listTypeName === 'bulletList' || listTypeName === 'orderedList') {
    return 'listItem'
  }

  return null
}

function resolveOutlineItemAtPos(editor: Editor, itemPos: number) {
  const $pos = editor.state.doc.resolve(itemPos + 1)

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const candidateNode = $pos.node(depth)
    const candidatePos = $pos.before(depth)

    if (candidatePos !== itemPos) {
      continue
    }

    const candidateType = OUTLINE_ITEM_TYPES.find((type) => type === candidateNode.type.name)

    if (!candidateType) {
      continue
    }

    const parentListDepth = depth - 1
    const parentListNode = $pos.node(parentListDepth)
    const parentListPos = $pos.before(parentListDepth)
    const parentItemDepth = parentListDepth - 1
    const parentItemNode = parentItemDepth > 0 ? $pos.node(parentItemDepth) : null
    const parentItemType =
      parentItemNode && OUTLINE_ITEM_TYPES.includes(parentItemNode.type.name as OutlineItemType)
        ? (parentItemNode.type.name as OutlineItemType)
        : null

    return {
      indexInParent: $pos.index(parentListDepth),
      itemDepth: depth,
      itemNode: candidateNode,
      itemPos,
      itemType: candidateType,
      parentItemDepth,
      parentItemNode,
      parentItemType,
      parentListDepth,
      parentListNode,
      parentListPos
    }
  }

  return null
}

function outlineChildList(itemPos: number, itemNode: { childCount: number; child: (index: number) => { nodeSize: number; type: { name: string } } }) {
  let childPos = itemPos + 1

  for (let index = 0; index < itemNode.childCount; index += 1) {
    const childNode = itemNode.child(index)

    if (OUTLINE_PARENT_NODE_NAMES.has(childNode.type.name)) {
      return {
        listNode: childNode,
        listPos: childPos
      }
    }

    childPos += childNode.nodeSize
  }

  return null
}

function collectVisibleOutlineItems(editor: Editor) {
  const items: Array<
    NonNullable<ReturnType<typeof resolveOutlineItemAtPos>> & {
      childListNode: { nodeSize: number; type: { name: string } } | null
      childListPos: number | null
      hasExpandedChildren: boolean
    }
  > = []

  editor.state.doc.descendants((node, pos) => {
    if (!OUTLINE_ITEM_TYPES.includes(node.type.name as OutlineItemType)) {
      return true
    }

    const outlineItem = resolveOutlineItemAtPos(editor, pos)

    if (!outlineItem) {
      return !Boolean(node.attrs.collapsed)
    }

    const childList = outlineChildList(outlineItem.itemPos, outlineItem.itemNode)
    const hasExpandedChildren = Boolean(childList) && !Boolean(outlineItem.itemNode.attrs.collapsed)

    items.push({
      ...outlineItem,
      childListNode: childList?.listNode ?? null,
      childListPos: childList?.listPos ?? null,
      hasExpandedChildren
    })

    return !Boolean(node.attrs.collapsed)
  })

  return items
}

function moveCurrentListOutlineItem(
  editor: Editor,
  outlineItem: NonNullable<ReturnType<typeof currentOutlineItem>>,
  direction: 'up' | 'down'
) {
  const visibleItems = collectVisibleOutlineItems(editor)
  const currentIndex = visibleItems.findIndex((candidate) => candidate.itemPos === outlineItem.itemPos)

  if (currentIndex === -1) {
    return false
  }

  let subtreeEndIndex = currentIndex

  while (
    subtreeEndIndex + 1 < visibleItems.length &&
    visibleItems[subtreeEndIndex + 1].itemDepth > outlineItem.itemDepth
  ) {
    subtreeEndIndex += 1
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : subtreeEndIndex + 1

  if (targetIndex < 0 || targetIndex >= visibleItems.length) {
    return false
  }

  const anchorOffset = Math.max(
    1,
    Math.min(editor.state.selection.from - outlineItem.itemPos, Math.max(1, outlineItem.itemNode.nodeSize - 2))
  )
  const targetItem = visibleItems[targetIndex]
  const canInsertIntoTargetParent =
    outlineListItemType(targetItem.parentListNode.type.name) === outlineItem.itemType

  if (!canInsertIntoTargetParent) {
    return false
  }

  const shouldDescendIntoTarget =
    direction === 'down' &&
    targetItem.hasExpandedChildren &&
    targetItem.childListNode !== null &&
    targetItem.childListPos !== null &&
    outlineListItemType(targetItem.childListNode.type.name) === outlineItem.itemType

  const desiredInsertPos = shouldDescendIntoTarget
    ? (targetItem.childListPos ?? targetItem.itemPos) + 1
    : direction === 'up'
      ? targetItem.itemPos
      : targetItem.itemPos + targetItem.itemNode.nodeSize
  const tr = editor.state.tr.delete(
    outlineItem.itemPos,
    outlineItem.itemPos + outlineItem.itemNode.nodeSize
  )
  const insertPos = tr.mapping.map(desiredInsertPos, -1)

  tr.insert(insertPos, outlineItem.itemNode)
  tr.setSelection(
    TextSelection.near(
      tr.doc.resolve(Math.min(insertPos + anchorOffset, insertPos + outlineItem.itemNode.nodeSize - 1))
    )
  )

  editor.view.dispatch(tr.scrollIntoView())
  return true
}

function moveCurrentTopLevelOutlineBlock(editor: Editor, direction: 'up' | 'down') {
  const currentBlock = currentTopLevelOutlineBlock(editor)

  if (!currentBlock) {
    return false
  }

  const blocks = collectTopLevelOutlineBlocks(editor)
  const currentIndex = blocks.findIndex((candidate) => candidate.pos === currentBlock.pos)

  if (currentIndex === -1) {
    return false
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

  if (targetIndex < 0 || targetIndex >= blocks.length) {
    return false
  }

  const targetBlock = blocks[targetIndex]
  const maxOffset = Math.max(1, currentBlock.node.nodeSize - 2)
  const anchorOffset = Math.max(
    1,
    Math.min(editor.state.selection.from - currentBlock.pos, maxOffset)
  )
  const desiredInsertPos =
    direction === 'up' ? targetBlock.pos : targetBlock.pos + targetBlock.node.nodeSize
  const tr = editor.state.tr.delete(currentBlock.pos, currentBlock.pos + currentBlock.node.nodeSize)
  const insertPos = tr.mapping.map(desiredInsertPos, -1)

  tr.insert(insertPos, currentBlock.node)
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.max(insertPos + 1, Math.min(insertPos + anchorOffset, insertPos + maxOffset))))
  )

  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export function moveCurrentOutlineItem(editor: Editor, direction: 'up' | 'down') {
  const outlineItem = currentOutlineItem(editor)

  if (outlineItem) {
    return moveCurrentListOutlineItem(editor, outlineItem, direction)
  }

  return moveCurrentTopLevelOutlineBlock(editor, direction)
}

export function setCurrentOutlineItemCollapsed(editor: Editor, collapsed: boolean) {
  const outlineItem = currentOutlineItem(editor)

  if (!outlineItem || !outlineItemHasNestedList(outlineItem.itemNode)) {
    return false
  }

  if (Boolean(outlineItem.itemNode.attrs.collapsed) === collapsed) {
    return true
  }

  const tr = editor.state.tr.setNodeMarkup(outlineItem.itemPos, undefined, {
    ...outlineItem.itemNode.attrs,
    collapsed
  })

  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export function toggleCurrentOutlineItemCollapsed(editor: Editor) {
  const outlineItem = currentOutlineItem(editor)

  if (!outlineItem || !outlineItemHasNestedList(outlineItem.itemNode)) {
    return false
  }

  return setCurrentOutlineItemCollapsed(editor, !Boolean(outlineItem.itemNode.attrs.collapsed))
}

export function indentCurrentOutlineItem(editor: Editor) {
  const outlineItem = currentOutlineItem(editor)

  if (!outlineItem) {
    return false
  }

  return editor.commands.sinkListItem(outlineItem.itemType)
}

export function outdentCurrentOutlineItem(editor: Editor) {
  const outlineItem = currentOutlineItem(editor)

  if (!outlineItem) {
    return false
  }

  return editor.commands.liftListItem(outlineItem.itemType)
}

export function transformCurrentBlockToList(
  editor: Editor,
  command: Extract<SlashCommand, 'bulletList' | 'orderedList' | 'taskList'>
) {
  switch (command) {
    case 'bulletList':
      return editor.commands.toggleBulletList()
    case 'orderedList':
      return editor.commands.toggleOrderedList()
    case 'taskList':
      return editor.commands.toggleTaskList()
  }
}

export const MarkdownListItem = ListItem.extend({
  addAttributes() {
    return outlineItemAttributes(this.parent?.())
  }
})

export const MarkdownTaskItem = TaskItem.extend({
  addAttributes() {
    return outlineItemAttributes(this.parent?.())
  },

  addInputRules() {
    return []
  }
})

export const MarkdownShortcutExtension = Extension.create({
  name: 'markdownShortcutExtension',
  priority: 1000,

  addInputRules() {
    return [
      new InputRule({
        find: SLASH_COMMAND_INPUT_PATTERN,
        handler: ({ chain, match, range }) => {
          const command = resolveSlashCommand(match[1] ?? '')

          if (!command) {
            return null
          }

          if (!runSlashCommand(command, chain(), range)) {
            return null
          }
        }
      })
    ]
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => indentCurrentOutlineItem(this.editor),
      'Shift-Tab': () => outdentCurrentOutlineItem(this.editor),
      'Mod-Enter': () => toggleCurrentOutlineItemCollapsed(this.editor),
      'Mod-Alt-ArrowLeft': () => setCurrentOutlineItemCollapsed(this.editor, true),
      'Mod-Alt-ArrowRight': () => setCurrentOutlineItemCollapsed(this.editor, false),
      'Mod-Shift-ArrowDown': () => moveCurrentOutlineItem(this.editor, 'down'),
      'Mod-Shift-ArrowUp': () => moveCurrentOutlineItem(this.editor, 'up'),
      'Mod-Alt-5': () => transformCurrentBlockToList(this.editor, 'bulletList'),
      'Mod-Shift-5': () => transformCurrentBlockToList(this.editor, 'bulletList'),
      'Mod-Alt-6': () => transformCurrentBlockToList(this.editor, 'orderedList'),
      'Mod-Shift-6': () => transformCurrentBlockToList(this.editor, 'orderedList'),
      'Mod-Alt-7': () => transformCurrentBlockToList(this.editor, 'taskList'),
      'Mod-Shift-7': () => transformCurrentBlockToList(this.editor, 'taskList'),
      Enter: () => {
        const shortcut = currentShortcutRange(this.editor)

        if (!shortcut) {
          return false
        }

        const slashCommandMatch = shortcut.text.match(SLASH_COMMAND_ENTER_PATTERN)

        if (slashCommandMatch) {
          const command = resolveSlashCommand(slashCommandMatch[1] ?? '')

          if (!command) {
            return false
          }

          return runSlashCommand(command, this.editor.chain(), shortcut.range)
        }

        const taskShortcutMatch = shortcut.text.match(TASK_LINE_ENTER_PATTERN)

        if (taskShortcutMatch) {
          return insertTaskList(this.editor.chain(), shortcut.range, {
            checked: (taskShortcutMatch[1] ?? '').toLowerCase() === 'x',
            createTrailingItem: true,
            text: taskShortcutMatch[2]?.trimEnd() ?? ''
          })
        }

        if (HORIZONTAL_RULE_MARKER_PATTERN.test(shortcut.text.trim())) {
          return runSlashCommand('horizontalRule', this.editor.chain(), shortcut.range)
        }

        return false
      }
    }
  }
})
