import { FileText, Image as ImageIcon, FileSpreadsheet, Presentation, Code, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface FilePreviewProps {
  file: File
  onRemove: () => void
}

function getFileTypeLabel(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.pdf': return 'PDF';
    case '.doc':
    case '.docx': return 'WORD';
    case '.ppt':
    case '.pptx': return 'PPT';
    case '.xls':
    case '.xlsx': return 'EXCEL';
    case '.csv': return 'CSV';
    case '.txt':
    case '.md':
    case '.json': return 'TEXT';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.gif':
    case '.svg':
    case '.bmp':
    case '.tiff': return 'IMAGE';
    default: return 'FILE';
  }
}

function getFileGradient(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.pdf': return 'from-rose-500 to-pink-600 shadow-rose-500/20';
    case '.doc':
    case '.docx': return 'from-blue-500 to-indigo-600 shadow-blue-500/20';
    case '.ppt':
    case '.pptx': return 'from-orange-500 to-amber-600 shadow-orange-500/20';
    case '.xls':
    case '.xlsx':
    case '.csv': return 'from-emerald-500 to-teal-600 shadow-emerald-500/20';
    case '.txt':
    case '.md':
    case '.json': return 'from-slate-600 to-slate-800 shadow-slate-600/20';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.gif':
    case '.svg':
    case '.bmp':
    case '.tiff': return 'from-violet-500 to-purple-600 shadow-purple-500/20';
    default: return 'from-slate-500 to-slate-600 shadow-slate-500/20';
  }
}

function getFileIcon(filename: string) {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.ppt':
    case '.pptx':
      return <Presentation className="w-5 h-5 text-white" />;
    case '.xls':
    case '.xlsx':
    case '.csv':
      return <FileSpreadsheet className="w-5 h-5 text-white" />;
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.gif':
    case '.svg':
    case '.bmp':
    case '.tiff':
      return <ImageIcon className="w-5 h-5 text-white" />;
    case '.json':
    case '.md':
      return <Code className="w-5 h-5 text-white" />;
    default:
      return <FileText className="w-5 h-5 text-white" />;
  }
}

export function FilePreview({ file, onRemove }: FilePreviewProps) {
  const fileSizeKB = (file.size / 1024).toFixed(0)
  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1)
  const displaySize = file.size > 1024 * 1024 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`
  const typeLabel = getFileTypeLabel(file.name)
  const gradient = getFileGradient(file.name)
  const Icon = getFileIcon(file.name)

  return (
    <div className="group glass-card flex items-center gap-3 rounded-xl p-3 hover:shadow-md transition-all duration-200">
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-md`}>
        {Icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">{file.name}</p>
        <p className="text-xs text-muted-foreground">{typeLabel} • {displaySize}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 border border-rose-200/60 transition-all duration-200 shrink-0 flex items-center justify-center shadow-sm"
        onClick={onRemove}
        title="Remove file"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
