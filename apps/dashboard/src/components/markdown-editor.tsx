import "@blocknote/shadcn/style.css";
import { BlockNoteEditor } from "@blocknote/core";
import {
  AddBlockButton,
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  DragHandleButton,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  NestBlockButton,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  UnnestBlockButton,
  useCreateBlockNote,
} from "@blocknote/react";
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
 * less than the editor can, so the menus offer only what survives the round trip: no colours, no
 * alignment.
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
  // The card is the editor element itself (styled in styles.css through BlockNote's theme
  // variables and classes), so the text is flush with its own frame and the block handles sit in
  // its left padding. BlockNote copies the view's className onto the portal root it appends after
  // the editor, so the view carries no class of ours.
  return (
    <div>
      <BlockNoteView
        editor={editor}
        editable={props.editable}
        theme={props.theme}
        sideMenu={false}
        formattingToolbar={false}
        onChange={(current) => props.onChange(current.blocksToMarkdownLossy(current.document))}
      >
        <SideMenuController
          sideMenu={(menu) => (
            <SideMenu {...menu}>
              <AddBlockButton />
              <DragHandleButton
                {...menu}
                dragHandleMenu={() => (
                  <DragHandleMenu>
                    <RemoveBlockItem>Delete</RemoveBlockItem>
                  </DragHandleMenu>
                )}
              />
            </SideMenu>
          )}
        />
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              <BlockTypeSelect key="blockTypeSelect" />
              <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
              <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
              <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
              <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />
              <NestBlockButton key="nestBlockButton" />
              <UnnestBlockButton key="unnestBlockButton" />
              <CreateLinkButton key="createLinkButton" />
            </FormattingToolbar>
          )}
        />
      </BlockNoteView>
    </div>
  );
}
