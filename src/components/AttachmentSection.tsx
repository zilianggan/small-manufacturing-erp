import React, { useRef, useState } from 'react';
import { Paperclip, X, File, Download, UploadCloud, Eye } from 'lucide-react';
import { Attachment } from '../types';

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
    <div className="space-y-1.5 w-full text-xs text-slate-600">
      <label className="font-semibold block text-slate-700">{label}</label>
      
      {attachment ? (
        <div className="space-y-2 mt-2">
          <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="flex items-center space-x-2 min-w-0">
              <File className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="truncate text-slate-700">{attachment.name}</span>
              <span className="text-[10px] text-slate-400 shrink-0">({formatSize(attachment.size)})</span>
            </div>
            <button onClick={handleRemove} className="p-1 hover:bg-slate-200 rounded text-slate-500">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : (
        <div 
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400'}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <UploadCloud className="w-6 h-6 mx-auto text-slate-400 mb-2" />
          <p className="text-slate-500">{helperText}</p>
          <input 
            ref={fileInputRef}
            type="file" 
            className="hidden" 
            onChange={onFileInputChange}
          />
        </div>
      )}

      {errorMsg && (
        <p className="text-[10px] text-red-500 font-medium font-sans animate-pulse">
          ⚠️ {errorMsg}
        </p>
      )}
    </div>
  );
}
