import React, { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type InputHTMLAttributes } from "react";

export type FileMetadata = {
  name: string;
  size: number;
  type: string;
  url: string;
  id: string;
};

export type FileWithPreview = {
  file: File | FileMetadata;
  id: string;
  preview?: string;
};

export type FileUploadOptions = {
  maxFiles?: number;
  maxSize?: number;
  accept?: string;
  multiple?: boolean;
  initialFiles?: FileMetadata[];
  onFilesChange?: (files: FileWithPreview[]) => void;
  onFilesAdded?: (addedFiles: FileWithPreview[]) => void;
};

export type FileUploadState = {
  files: FileWithPreview[];
  isDragging: boolean;
  errors: string[];
};

export type FileUploadActions = {
  addFiles: (files: FileList | File[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  clearErrors: () => void;
  handleDragEnter: (e: DragEvent<HTMLElement>) => void;
  handleDragLeave: (e: DragEvent<HTMLElement>) => void;
  handleDragOver: (e: DragEvent<HTMLElement>) => void;
  handleDrop: (e: DragEvent<HTMLElement>) => void;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  openFileDialog: () => void;
  getInputProps: (props?: InputHTMLAttributes<HTMLInputElement>) => InputHTMLAttributes<HTMLInputElement> & { ref: React.RefObject<HTMLInputElement | null> };
};

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function useFileUpload(options: FileUploadOptions = {}): [FileUploadState, FileUploadActions] {
  const {
    maxFiles = Infinity,
    maxSize = Infinity,
    accept = "*",
    multiple = false,
    initialFiles = [],
    onFilesChange,
    onFilesAdded,
  } = options;

  const [state, setState] = useState<FileUploadState>({
    files: initialFiles.map((file) => ({
      file,
      id: file.id,
      preview: file.url,
    })),
    isDragging: false,
    errors: [],
  });

  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback(
    (file: File | FileMetadata): string | null => {
      const size = file instanceof File ? file.size : file.size;
      const name = file instanceof File ? file.name : file.name;
      const type = file instanceof File ? file.type : file.type;
      if (size > maxSize) {
        return `File "${name}" exceeds the maximum size of ${formatBytes(maxSize)}.`;
      }
      if (accept !== "*") {
        const acceptedTypes = accept.split(",").map((t) => t.trim());
        const fileExtension = "." + (file instanceof File ? file.name.split(".").pop() : file.name.split(".").pop());
        const isAccepted = acceptedTypes.some((t) => {
          if (t.startsWith(".")) return fileExtension.toLowerCase() === t.toLowerCase();
          if (t.endsWith("/*")) return type.startsWith(t.split("/")[0] + "/");
          return type === t;
        });
        if (!isAccepted) return `File "${name}" is not an accepted file type.`;
      }
      return null;
    },
    [accept, maxSize]
  );

  const createPreview = useCallback((file: File | FileMetadata): string | undefined => {
    if (file instanceof File) return URL.createObjectURL(file);
    return (file as FileMetadata).url;
  }, []);

  const generateUniqueId = useCallback((file: File | FileMetadata): string => {
    if (file instanceof File) return `${file.name}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    return (file as FileMetadata).id;
  }, []);

  const clearFiles = useCallback(() => {
    setState((prev) => {
      prev.files.forEach((f) => {
        if (f.preview && f.file instanceof File && f.file.type.startsWith("image/")) URL.revokeObjectURL(f.preview);
      });
      if (inputRef.current) inputRef.current.value = "";
      const newState = { ...prev, files: [], errors: [] };
      onFilesChange?.(newState.files);
      return newState;
    });
  }, [onFilesChange]);

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const arr = Array.from(newFiles || []);
      if (arr.length === 0) return;
      setState((prev) => {
        const errors: string[] = [];
        if (!multiple) {
          prev.files.forEach((f) => {
            if (f.preview && f.file instanceof File && f.file.type.startsWith("image/")) URL.revokeObjectURL(f.preview);
          });
        }
        const nextFiles = !multiple ? [] : [...prev.files];
        if (multiple && maxFiles !== Infinity && nextFiles.length + arr.length > maxFiles) {
          errors.push(`You can only upload a maximum of ${maxFiles} files.`);
          return { ...prev, errors };
        }
        const validFiles: FileWithPreview[] = [];
        arr.forEach((file) => {
          if (multiple && nextFiles.some((e) => e.file.name === file.name && (e.file as File).size === file.size)) return;
          const err = validateFile(file);
          if (err) errors.push(err);
          else validFiles.push({ file, id: generateUniqueId(file), preview: createPreview(file) });
        });
        if (validFiles.length === 0) return { ...prev, errors };
        onFilesAdded?.(validFiles);
        const newFiles = !multiple ? validFiles : [...nextFiles, ...validFiles];
        onFilesChange?.(newFiles);
        if (inputRef.current) inputRef.current.value = "";
        return { ...prev, files: newFiles, errors };
      });
    },
    [multiple, maxFiles, validateFile, createPreview, generateUniqueId, onFilesChange, onFilesAdded]
  );

  const removeFile = useCallback(
    (id: string) => {
      setState((prev) => {
        const f = prev.files.find((x) => x.id === id);
        if (f?.preview && f.file instanceof File && f.file.type.startsWith("image/")) URL.revokeObjectURL(f.preview);
        const newFiles = prev.files.filter((x) => x.id !== id);
        onFilesChange?.(newFiles);
        return { ...prev, files: newFiles, errors: [] };
      });
    },
    [onFilesChange]
  );

  const clearErrors = useCallback(() => setState((prev) => ({ ...prev, errors: [] })), []);

  const handleDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setState((prev) => ({ ...prev, isDragging: true }));
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setState((prev) => ({ ...prev, isDragging: false }));
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setState((prev) => ({ ...prev, isDragging: false }));
      if (inputRef.current?.disabled) return;
      if (e.dataTransfer.files?.length) {
        if (!multiple) addFiles([e.dataTransfer.files[0]]);
        else addFiles(e.dataTransfer.files);
      }
    },
    [addFiles, multiple]
  );

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files);
    },
    [addFiles]
  );

  const openFileDialog = useCallback(() => inputRef.current?.click(), []);

  const getInputProps = useCallback(
    (props: InputHTMLAttributes<HTMLInputElement> = {}) => ({
      ...props,
      type: "file" as const,
      onChange: handleFileChange,
      accept: props.accept ?? accept,
      multiple: props.multiple !== undefined ? props.multiple : multiple,
      ref: inputRef,
    }),
    [accept, multiple, handleFileChange]
  );

  return [
    state,
    {
      addFiles,
      removeFile,
      clearFiles,
      clearErrors,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      handleFileChange,
      openFileDialog,
      getInputProps,
    },
  ];
}
