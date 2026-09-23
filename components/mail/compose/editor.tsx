"use client";

import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Headings, bold, italic, underline, links and inline images. Nothing else. */
export function useComposeEditor({
  placeholder,
  onUpdate,
  onError,
  onSubmit,
  onEscape,
}: {
  placeholder: string;
  onUpdate: (editor: Editor) => void;
  onError: (message: string) => void;
  onSubmit: () => void;
  onEscape: () => void;
}) {
  const submitRef = useRef(onSubmit);
  const escapeRef = useRef(onEscape);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    submitRef.current = onSubmit;
    escapeRef.current = onEscape;
  });

  const insertFiles = (editor: Editor, files: File[], pos?: number) => {
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (!images.length) return false;
    for (const file of images) {
      if (file.size > MAX_IMAGE_BYTES) {
        onError(`${file.name} is over 5 mb`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const chain = editor.chain().focus();
        (pos === undefined ? chain : chain.setTextSelection(pos)).setImage({ src, alt: file.name }).run();
      };
      reader.readAsDataURL(file);
    }
    return true;
  };

  const editor: Editor | null = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      Image.configure({ inline: true, allowBase64: true }),
      Placeholder.configure({ placeholder }),
      // HardBreak claims mod+enter and the base keymap claims escape, so the
      // global compose keys never see them from inside the body. Route them here.
      Extension.create({
        name: "composeKeys",
        priority: 1000,
        addKeyboardShortcuts: () => ({
          "Mod-Enter": () => {
            submitRef.current();
            return true;
          },
          Escape: () => {
            escapeRef.current();
            return true;
          },
        }),
      }),
    ],
    editorProps: {
      attributes: { "aria-label": "message body", class: "outline-none" },
      handlePaste: (view, event): boolean => {
        const files = Array.from(event.clipboardData?.files ?? []);
        return files.length ? insertFiles(editorRef.current!, files) : false;
      },
      handleDrop: (view, event): boolean => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        return insertFiles(editorRef.current!, files, pos);
      },
    },
    onUpdate: ({ editor: e }) => onUpdate(e),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  return { editor, insertFiles };
}

const body = cn(
  "min-h-editor px-3 py-2 leading-prose text-text",
  "[&_h1]:text-20 [&_h1]:font-semibold [&_h2]:text-15 [&_h2]:font-semibold [&_h3]:text-13 [&_h3]:font-semibold",
  "[&_a]:text-text [&_a]:underline [&_img]:inline [&_img]:max-w-full [&_img]:rounded-sm",
  "[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-text-dim [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
);

export function ComposeBody({ editor }: { editor: Editor | null }) {
  return <EditorContent editor={editor} className={body} />;
}

export function ComposeToolbar({
  editor,
  linkOpen,
  setLinkOpen,
  onImages,
}: {
  editor: Editor | null;
  linkOpen: boolean;
  setLinkOpen: (open: boolean) => void;
  onImages: (files: File[]) => void;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      h3: e?.isActive("heading", { level: 3 }) ?? false,
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      link: e?.isActive("link") ?? false,
    }),
  });

  if (!editor) return <div className="h-row border-b border-border" />;
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();

  const tools: { key: string; label: string; title: string; on: boolean; action: () => void }[] = [
    { key: "h1", label: "h1", title: "heading 1  mod+alt+1", on: !!active?.h1, action: () => run((c) => c.toggleHeading({ level: 1 })) },
    { key: "h2", label: "h2", title: "heading 2  mod+alt+2", on: !!active?.h2, action: () => run((c) => c.toggleHeading({ level: 2 })) },
    { key: "h3", label: "h3", title: "heading 3  mod+alt+3", on: !!active?.h3, action: () => run((c) => c.toggleHeading({ level: 3 })) },
    { key: "b", label: "b", title: "bold  mod+b", on: !!active?.bold, action: () => run((c) => c.toggleBold()) },
    { key: "i", label: "i", title: "italic  mod+i", on: !!active?.italic, action: () => run((c) => c.toggleItalic()) },
    { key: "u", label: "u", title: "underline  mod+u", on: !!active?.underline, action: () => run((c) => c.toggleUnderline()) },
    { key: "link", label: "link", title: "link  mod+k", on: !!active?.link || linkOpen, action: () => setLinkOpen(!linkOpen) },
  ];

  return (
    <div className="flex flex-col border-b border-border">
      <div role="toolbar" aria-label="formatting" className="flex h-row items-center gap-1 overflow-x-auto px-2">
        {tools.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.title}
            aria-pressed={t.on}
            onMouseDown={(e) => e.preventDefault()}
            onClick={t.action}
            className={cn(
              "flex h-6 shrink-0 items-center rounded-sm px-2 text-11 transition-colors duration-80 ease-snap hover:text-text",
              t.on ? "bg-surface-raised text-text" : "text-text-muted",
              t.key === "b" && "font-semibold",
              t.key === "i" && "italic",
              t.key === "u" && "underline",
            )}
          >
            {t.label}
          </button>
        ))}
        <label
          title="inline image, or paste one"
          className="relative flex h-6 shrink-0 cursor-pointer items-center rounded-sm px-2 text-11 text-text-muted transition-colors duration-80 ease-snap hover:text-text has-focus-visible:text-accent"
        >
          image
          <input
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            className="sr-only"
            onChange={(e) => {
              onImages(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {linkOpen ? <LinkInput editor={editor} close={() => setLinkOpen(false)} /> : null}
    </div>
  );
}

function LinkInput({ editor, close }: { editor: Editor; close: () => void }) {
  const [href, setHref] = useState(() => (editor.getAttributes("link").href as string | undefined) ?? "");

  const apply = () => {
    const value = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!value) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href: value } }] }).run();
    } else chain.setLink({ href: value }).run();
    close();
  };

  return (
    <label className="flex h-row items-center gap-2 border-t border-border px-3">
      <span className="text-11 text-text-muted">url</span>
      <input
        autoFocus
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          // Handled here so the compose layer's esc and enter never see it.
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
            editor.commands.focus();
          }
        }}
        placeholder="https://  enter to apply, empty to remove"
        className="min-w-0 flex-1 bg-transparent text-13 text-text outline-none placeholder:text-text-dim"
      />
    </label>
  );
}
