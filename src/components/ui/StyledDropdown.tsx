import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
}

interface StyledDropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}

export function StyledDropdown({ value, options, onChange }: StyledDropdownProps) {
  const [openMenu, setOpenMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpenMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openMenu]);

  return (
    <div className="select-wrap" ref={ref}>
      <button
        type="button"
        className="field-control select-trigger"
        onClick={() => setOpenMenu((current) => !current)}
        aria-expanded={openMenu}
      >
        <span>{options.find((option) => option.value === value)?.label}</span>
        <ChevronDown size={18} className={openMenu ? "select-chevron open" : "select-chevron"} />
      </button>
      <AnimatePresence>
        {openMenu && (
          <motion.div
            className="select-menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
          >
            {options.map((option) => (
              <button
                type="button"
                className={option.value === value ? "select-option selected" : "select-option"}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpenMenu(false);
                }}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={16} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default StyledDropdown;
