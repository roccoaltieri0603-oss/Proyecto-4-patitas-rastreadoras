import { useEffect, useRef, useState } from "react";
import Button from "./ui/Button";
import Modal, { MODAL_CARD_CLASS } from "./ui/Modal";

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
    <Modal onDismiss={onCancel}>
      <form
        className={MODAL_CARD_CLASS}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="m-0 text-lg">{title}</h2>
        <label className="text-sm text-gray-600" htmlFor="prompt-modal-input">
          {label}
        </label>
        <input
          id="prompt-modal-input"
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="rounded-md border border-gray-300 px-2.5 py-2 text-[0.95rem]"
        />
        <div className="mt-1.5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {confirmText}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
