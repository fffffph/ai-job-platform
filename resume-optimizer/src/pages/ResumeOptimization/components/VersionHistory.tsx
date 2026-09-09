import React from "react";
import { Select } from "antd";
import type { ResumeVersion } from "../../../hooks/useConversation";

interface Props {
  versions: ResumeVersion[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

const VersionHistory: React.FC<Props> = ({ versions, currentIndex, onSelect }) => {
  if (versions.length <= 1) return null;

  return (
    <Select
      size="small"
      style={{ minWidth: 160 }}
      value={currentIndex}
      onChange={onSelect}
      options={versions.map((v) => ({
        value: v.index,
        label: `${v.label} ${currentIndex === v.index ? "●" : ""}`,
      }))}
    />
  );
};

export default VersionHistory;
