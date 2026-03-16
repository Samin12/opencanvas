import '@tiptap/extension-horizontal-rule'

import { Extension, InputRule, type ChainedCommands, type Editor, type Range } from '@tiptap/core'
import { TaskItem } from '@tiptap/extension-list'
import { TextSelection } from '@tiptap/pm/state'

type SlashCommand =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'

const SLASH_COMMAND_ALIASES: Record<string, SlashCommand> = {
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
  task: 'taskList',
  text: 'paragraph',
  todo: 'taskList',
  ul: 'bulletList'
}

const SLASH_COMMAND_INPUT_PATTERN = /^\/([a-z0-9-]+)\s$/i
const SLASH_COMMAND_ENTER_PATTERN = /^\/([a-z0-9-]+)\s*$/i
const HORIZONTAL_RULE_MARKER_PATTERN = /^(?:---|___|\*\*\*)$/
const TASK_LINE_ENTER_PATTERN = /^\s*(?:[-+*]\s+)?\[\s*(x|X)?\]\s+(.+)$/

function resolveSlashCommand(rawCommand: string) {
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

function runSlashCommand(command: SlashCommand, chain: ChainedCommands, range: Range) {
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

export const MarkdownTaskItem = TaskItem.extend({
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
