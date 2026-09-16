import "@blocknote/shadcn/style.css";
import { BlockNoteEditor } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useState } from "react";

/** Parsing needs an editor; one headless instance serves every document. */
let parser: BlockNoteEditor | null = null;
const parse = (markdown: string) => {
  parser ??= BlockNoteEditor.create();
  return parser.tryParseMarkdownToBlocks(markdown);
};

/**
 * A block editor over a Markdown document. Mount it with a `key` per document: the text is parsed
 * once when the editor is created, and every change comes back out as Markdown. Markdown carries
 * less than the editor can (no colours, no nested paragraphs), so what is saved is what the agent
 * will read, and the round trip keeps to that subset.
 */
export function MarkdownEditor(props: {
  markdown: string;
  editable: boolean;
  theme: "light" | "dark";
  placeholder?: string;
  onChange: (markdown: string) => void;
}) {
  const [blocks] = useState(() => parse(props.markdown));
  const editor = useCreateBlockNote({
    initialContent: blocks.length > 0 ? blocks : undefined,
    ...(props.placeholder ? { placeholders: { default: props.placeholder } } : {}),
  });
  // BlockNote copies its className onto the portal root it appends after the editor, so the
  // frame is a wrapper of our own and the view carries no class.
  return (
    <div className="bg-card min-h-[28rem] rounded-lg py-6 ring-1 ring-foreground/10">
      <BlockNoteView
        editor={editor}
        editable={props.editable}
        theme={props.theme}
        onChange={(current) => props.onChange(current.blocksToMarkdownLossy(current.document))}
      />
    </div>
  );
}
