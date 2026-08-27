import Button from "./ui/Button";
import Modal, { MODAL_CARD_CLASS } from "./ui/Modal";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmText = "Eliminar",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal onDismiss={onCancel}>
      <div className={MODAL_CARD_CLASS} onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="m-0 text-lg">{title}</h2>
        <p className="m-0 text-sm leading-normal text-gray-700">{message}</p>
        <div className="mt-1.5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
