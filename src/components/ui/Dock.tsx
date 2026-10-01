import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
  type SpringOptions,
} from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./Dock.css";

export interface DockItemData {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  /** Pantalla actual: se pinta con el verde de la marca. */
  activo?: boolean;
  className?: string;
}

interface DockProps {
  items: DockItemData[];
  className?: string;
  spring?: SpringOptions;
  magnification?: number;
  distance?: number;
  panelHeight?: number;
  dockHeight?: number;
  baseItemSize?: number;
}

const SPRING_POR_DEFECTO: SpringOptions = { mass: 0.1, stiffness: 150, damping: 12 };

function DockLabel({ children, isHovered }: { children: ReactNode; isHovered: MotionValue<number> }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => isHovered.on("change", (valor) => setVisible(valor === 1)), [isHovered]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className="dock-label"
          role="tooltip"
          style={{ x: "-50%" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DockItemProps {
  item: DockItemData;
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  distance: number;
  magnification: number;
  baseItemSize: number;
}

function DockItem({ item, mouseX, spring, distance, magnification, baseItemSize }: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (valor) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: baseItemSize };
    return valor - rect.x - baseItemSize / 2;
  });
  const targetSize = useTransform(mouseDistance, [-distance, 0, distance], [baseItemSize, magnification, baseItemSize]);
  const size = useSpring(targetSize, spring);

  return (
    <motion.div
      ref={ref}
      style={{ width: size, height: size }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={item.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          item.onClick();
        }
      }}
      className={`dock-item ${item.activo ? "dock-item-activo" : ""} ${item.className ?? ""}`}
      tabIndex={0}
      role="button"
      aria-label={item.label}
      aria-current={item.activo ? "page" : undefined}
    >
      <div className="dock-icon">{item.icon}</div>
      <DockLabel isHovered={isHovered}>{item.label}</DockLabel>
    </motion.div>
  );
}

export default function Dock({
  items,
  className = "",
  spring = SPRING_POR_DEFECTO,
  magnification = 60,
  distance = 180,
  panelHeight = 60,
  dockHeight = 200,
  baseItemSize = 44,
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(
    () => Math.max(dockHeight, magnification + magnification / 2 + 4),
    [magnification, dockHeight],
  );
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  // El fondo azul también crece: con alto fijo los íconos agrandados se salían
  // por arriba del panel. El margen extra cubre el rebote del spring.
  const panelHeightRow = useTransform(
    isHovered,
    [0, 1],
    [panelHeight, Math.max(panelHeight, magnification + 26)],
  );
  const panelHeightAnimada = useSpring(panelHeightRow, spring);

  return (
    <motion.div style={{ height, scrollbarWidth: "none" }} className="dock-outer">
      <motion.div
        // clientX y no pageX: el dock está fijo a la ventana, así que la
        // distancia tiene que medirse en coordenadas de viewport, igual que
        // getBoundingClientRect.
        onMouseMove={({ clientX }) => {
          isHovered.set(1);
          mouseX.set(clientX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        className={`dock-panel ${className}`}
        style={{ height: panelHeightAnimada }}
        role="toolbar"
        aria-label="Navegación principal"
      >
        {items.map((item) => (
          <DockItem
            key={item.label}
            item={item}
            mouseX={mouseX}
            spring={spring}
            distance={distance}
            magnification={magnification}
            baseItemSize={baseItemSize}
          />
        ))}
      </motion.div>
    </motion.div>
  );
}
