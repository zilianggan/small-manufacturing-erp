import React, { useRef, useState } from 'react';
import { X, File, UploadCloud } from 'lucide-react';
import { Attachment } from '../types';
import { openDataUrlInNewTab } from '../lib/utils';

interface AttachmentSectionProps {
  attachment?: Attachment;
  onAttachmentChange: (attachment?: Attachment) => void;
  label?: string;
  helperText?: string;
}

export default function AttachmentSection({
  attachment,
  onAttachmentChange,
  label = "Attachment (Optional)",
  helperText = "Attach PDF, blueprint, invoice, or image (Max 1MB for local storage)"
}: AttachmentSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFiles = (files: FileList) => {
    setErrorMsg(null);
    const file = files[0];
    if (!file) return;

    // Enforce 1MB limit for localStorage safety
    if (file.size > 1024 * 1024) {
      setErrorMsg(`File ${file.name} is too large! Please choose a file smaller than 1MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      onAttachmentChange({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl
      });
    };
    reader.readAsDataURL(file);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  };

  const handleRemove = () => {
    onAttachmentChange(undefined);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 1;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const isImage = attachment?.type.startsWith('image/');

  return (
    <div className="space-y-1.5 w-full text-xs text-muted-foreground">
      <label className="font-semibold block text-foreground">{label}</label>

      {attachment ? (
        isImage ? (
          <div className="relative mt-2 inline-block group">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              onClick={() => openDataUrlInNewTab(attachment.dataUrl)}
              className="max-h-48 max-w-full rounded-xl border border-border object-cover cursor-pointer"
            />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute top-2 right-2 p-1 bg-foreground/70 hover:bg-foreground/90 text-background rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove"
            >
              <X className="w-3 h-3" />
            </button>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{attachment.name}</span>
              <span className="shrink-0">({formatSize(attachment.size)})</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-2.5 mt-2 bg-secondary/50 border border-border rounded-lg">
            <div className="flex items-center space-x-2 min-w-0">
              <File className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate text-foreground">{attachment.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">({formatSize(attachment.size)})</span>
            </div>
            <button onClick={handleRemove} className="p-1 hover:bg-secondary rounded text-muted-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      ) : (
        <div
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <UploadCloud className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">{helperText}</p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onFileInputChange}
          />
        </div>
      )}

      {errorMsg && (
        <p className="text-[10px] text-destructive font-medium font-sans">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
