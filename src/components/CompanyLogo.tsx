import { Building2 } from 'lucide-react';
import { Attachment } from '../types';

const SIZE_CLASS = { sm: 'w-10 h-10', md: 'w-14 h-14' } as const;

/** Company avatar: renders the vendor/client's attachment as a logo when it's an image, else a placeholder. */
export default function CompanyLogo({ attachment, size = 'sm' }: { attachment?: Attachment; size?: 'sm' | 'md' }) {
  const isImage = attachment?.type?.startsWith('image/') && attachment.dataUrl;

  return (
    <div className={`${SIZE_CLASS[size]} rounded-full border border-slate-200 bg-slate-50 shrink-0 overflow-hidden flex items-center justify-center`}>
      {isImage ? (
        <img src={attachment!.dataUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <Building2 className="w-1/2 h-1/2 text-slate-300" />
      )}
    </div>
  );
}
