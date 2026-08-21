import { useEffect, useRef, useState } from "react";

interface PromptModalProps {
  title: string;
  label: string;
  initialValue?: string;
  confirmText?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function PromptModal({
  title,
  label,
  initialValue = "",
  confirmText = "Guardar",
  placeholder,
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <form
        className="modal-card"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{title}</h2>
        <label className="modal-label" htmlFor="prompt-modal-input">
          {label}
        </label>
        <input
          id="prompt-modal-input"
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
