import React, { useState } from "react";

import { useKnowledgeStore } from "../../stores/useKnowledgeStore";
import type { KnowledgeDocument } from "../../types/knowledge";

type Props = {
  document: KnowledgeDocument;
};

export function KnowledgeDocPreview({ document }: Props) {
  const updateDocument = useKnowledgeStore((s) => s.updateDocument);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(document.markdown);

  async function handleSave() {
    await updateDocument(document.id, editContent);
    setIsEditing(false);
  }

  function handleCancel() {
    setEditContent(document.markdown);
    setIsEditing(false);
  }

  return (
    <div className="knowledge-doc-preview">
      <div className="knowledge-doc-toolbar">
        <div className="knowledge-doc-toolbar-left">
          <h3 className="knowledge-doc-title">{document.title}</h3>
          <div className="knowledge-doc-meta-bar">
            <span>v{document.version}</span>
            {document.edited && <span className="knowledge-doc-edited-badge">已编辑</span>}
            <span>{new Date(document.updatedAt).toLocaleString("zh-CN")}</span>
          </div>
        </div>
        <div className="knowledge-doc-actions">
          {isEditing ? (
            <>
              <button className="knowledge-btn knowledge-btn--primary knowledge-btn--small" type="button" onClick={handleSave}>
                保存
              </button>
              <button className="knowledge-btn knowledge-btn--small" type="button" onClick={handleCancel}>
                取消
              </button>
            </>
          ) : (
            <button className="knowledge-btn knowledge-btn--small" type="button" onClick={() => setIsEditing(true)}>
              编辑
            </button>
          )}
        </div>
      </div>

      {isEditing ? (
        <textarea
          className="knowledge-doc-editor"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
        />
      ) : (
        <div className="knowledge-doc-content">
          <MarkdownContent markdown={document.markdown} />
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const elements: React.ReactElement[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="knowledge-md-code-block">
            <code>{codeContent.join("\n")}</code>
          </pre>
        );
        codeContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(<h4 key={`h3-${i}`} className="knowledge-md-h3">{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={`h2-${i}`} className="knowledge-md-h2">{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={`h1-${i}`} className="knowledge-md-h1">{line.slice(2)}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(<li key={`li-${i}`} className="knowledge-md-li">{line.slice(2)}</li>);
    } else if (line.trim() === "") {
      elements.push(<br key={`br-${i}`} />);
    } else {
      elements.push(<p key={`p-${i}`} className="knowledge-md-p">{line}</p>);
    }
  }

  return <>{elements}</>;
}
