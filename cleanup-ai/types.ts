
export interface EditorState {
  image: string | null;
  originalFile: File | null;
  maskBlob: Blob | null;
  isProcessing: boolean;
  resultImage: string | null;
  brushSize: number;
}

export enum AppStatus {
  IDLE = 'IDLE',
  EDITING = 'EDITING',
  PROCESSING = 'PROCESSING',
  RESULT = 'RESULT'
}
