'use client';

import { useState, useRef } from 'react';
import { Camera, X, Loader2 } from 'lucide-react';
import Image from 'next/image';

interface PhotoUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  required?: boolean;
  circular?: boolean;
  size?: 'default' | 'lg';
  /** The applicant's lead, sent with the file so the upload can check it. */
  leadId?: string | null;
}

export function PhotoUpload({ value, onChange, label = 'Upload photo', required = false, circular = false, size = 'default', leadId = null }: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10MB');
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (leadId) formData.append('leadId', leadId);

      const res = await fetch('/api/upload/nanny-photo', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await res.json();
      onChange(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />

      {value ? (
        <div className={`relative overflow-hidden border-2 border-violet-200 ${
          size === 'lg' ? 'w-40 h-40' : 'w-32 h-32'
        } ${circular ? 'rounded-full' : 'rounded-xl'}`}>
          <Image
            src={value}
            alt="Uploaded photo"
            fill
            className="object-cover"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-1 right-1 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-violet-400 hover:bg-violet-50/50 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            size === 'lg' ? 'w-40 h-40' : 'w-32 h-32'
          } ${circular ? 'rounded-full' : 'rounded-xl'}`}
        >
          {uploading ? (
            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
          ) : (
            <>
              <Camera className="w-6 h-6 text-slate-400" />
              <span className="text-xs text-slate-500">{label}</span>
              {required && <span className="text-xs text-red-400">Required</span>}
            </>
          )}
        </button>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
