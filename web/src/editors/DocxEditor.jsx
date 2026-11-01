import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

const EMPTY = '<p></p>';

function ToolButton({ active, onClick, children, title, disabled }) {
  return (
    <button className={`tool ${active ? 'active' : ''}`} onClick={onClick} title={title} disabled={disabled} type="button">
      {children}
    </button>
  );
}

export default function DocxEditor({ model, onChange, registerSelection, editorRef }) {
  const [html, setHtml] = useState(model?.html || EMPTY);
  const lastEmitted = useRef(html);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: model?.html || EMPTY,
    editorProps: {
      attributes: { class: 'doc-prose', spellcheck: 'false' },
    },
    onUpdate({ editor: instance }) {
      const next = instance.getHTML();
      lastEmitted.current = next;
      setHtml(next);
      onChange?.({ version: 1, html: next });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const incoming = model?.html || EMPTY;
    if (incoming !== lastEmitted.current && incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
      lastEmitted.current = incoming;
      setHtml(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.html, editor]);

  useImperativeHandle(
    editorRef,
    () => ({
      insertText(text) {
        editor?.chain().focus().insertContent(text).run();
      },
      replaceSelection(text) {
        editor?.chain().focus().insertContent(text).run();
      },
      insertImage(src, alt) {
        editor?.chain().focus().setImage({ src, alt }).run();
      },
      setHtml(next) {
        editor?.commands.setContent(next, { emitUpdate: true });
      },
    }),
    [editor],
  );

  useEffect(() => {
    if (!registerSelection || !editor) return;
    registerSelection(() => {
      const { from, to } = editor.state.selection;
      return from === to ? '' : editor.state.doc.textBetween(from, to, '\n');
    });
  }, [editor, registerSelection]);

  const stats = useMemo(() => {
    const text = editor?.getText() || '';
    return { chars: text.replace(/\s/g, '').length, paragraphs: editor?.state.doc.childCount || 0 };
  }, [editor, html]);

  const addImage = useCallback(() => {
    const url = window.prompt('图片地址（也可用素材库插入）');
    if (url) editor?.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const addLink = useCallback(() => {
    const url = window.prompt('链接地址', 'https://');
    if (url) editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return <div className="doc-canvas"><div className="muted">编辑器加载中…</div></div>;

  return (
    <div>
      <div className="toolbar" style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-soft)', position: 'sticky', top: 0, zIndex: 5 }}>
        <ToolButton title="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>↶</ToolButton>
        <ToolButton title="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>↷</ToolButton>
        <div className="divider-v" />
        <select
          className="select"
          style={{ width: 108, height: 30, padding: '0 8px' }}
          value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'p') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) }).run();
          }}
        >
          <option value="p">正文</option>
          <option value="h1">标题 1</option>
          <option value="h2">标题 2</option>
          <option value="h3">标题 3</option>
        </select>
        <div className="divider-v" />
        <ToolButton title="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolButton>
        <ToolButton title="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolButton>
        <ToolButton title="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolButton>
        <ToolButton title="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolButton>
        <ToolButton title="行内代码" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</ToolButton>
        <div className="divider-v" />
        <ToolButton title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolButton>
        <ToolButton title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolButton>
        <ToolButton title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolButton>
        <div className="divider-v" />
        <ToolButton title="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>⇤</ToolButton>
        <ToolButton title="居中" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>⇔</ToolButton>
        <ToolButton title="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>⇥</ToolButton>
        <div className="divider-v" />
        <ToolButton title="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</ToolButton>
        <ToolButton title="删除表格" onClick={() => editor.chain().focus().deleteTable().run()} disabled={!editor.can().deleteTable()}>▨</ToolButton>
        <ToolButton title="插入图片" onClick={addImage}>🖼</ToolButton>
        <ToolButton title="插入链接" active={editor.isActive('link')} onClick={addLink}>🔗</ToolButton>
        <ToolButton title="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>—</ToolButton>
        <div className="spacer" />
        <span className="small muted">{stats.chars} 字 · {stats.paragraphs} 段</span>
      </div>
      <div className="doc-canvas">
        <div className="doc-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
