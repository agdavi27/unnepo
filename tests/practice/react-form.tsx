import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Select from "@radix-ui/react-select";

/**
 * A practice form built the way React sites build theirs: controlled text boxes, a Radix Select (shadcn's
 * dropdown), a react-select style search box that keeps its choice beside the input, and a controlled
 * radio group. What the form holds is React's state, read by window.pageValues.
 */

const SCHOOLS = ["Bates College", "Bowdoin College", "Colby College", "Colby-Sawyer College", "Colgate University", "Columbia University"];

let state: Record<string, string> = {};
window.pageValues = () => ({ ...state });

function SchoolBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = useMemo(() => SCHOOLS.filter((school) => school.toLowerCase().includes(typed.toLowerCase())), [typed]);
  const choose = (school: string) => {
    onChange(school);
    setTyped("");
    setOpen(false);
  };
  return (
    <div className="select__container" style={{ position: "relative" }}>
      <div className="select__control" onMouseDown={() => setOpen(true)}>
        {value && !typed && <div className="select__single-value">{value}</div>}
        <input
          id="school"
          role="combobox"
          aria-expanded={open}
          aria-controls="school-list"
          aria-activedescendant={open && shown[active] ? `school-${active}` : undefined}
          aria-labelledby="school-label"
          value={typed}
          onChange={(event) => { setTyped(event.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { setOpen(true); setActive((at) => Math.min(shown.length - 1, open ? at + 1 : 0)); }
            if (event.key === "ArrowUp") setActive((at) => Math.max(0, at - 1));
            if (event.key === "Enter" && open && shown[active]) { event.preventDefault(); choose(shown[active]); }
            if (event.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && (
        <div id="school-list" role="listbox" className="select__menu">
          {shown.map((school, index) => (
            <div key={school} id={`school-${index}`} role="option" aria-selected={index === active} className={index === active ? "select__option select__option--is-focused" : "select__option"} onClick={() => choose(school)}>{school}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Form() {
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (name: string) => (value: string) => setValues((now) => ({ ...now, [name]: value }));
  useEffect(() => {
    state = values;
  }, [values]);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <div className="field">
        <label htmlFor="first">First name *</label>
        <input id="first" required value={values["First name"] ?? ""} onChange={(event) => set("First name")(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="email">Email *</label>
        <input id="email" type="email" required value={values.Email ?? ""} onChange={(event) => set("Email")(event.target.value)} />
      </div>
      <div className="field">
        <label id="auth-label">Are you legally authorized to work in the United States? *</label>
        <Select.Root value={values.auth ?? ""} onValueChange={set("auth")}>
          <Select.Trigger className="trigger" aria-labelledby="auth-label" aria-required="true">
            <Select.Value placeholder="Select…" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="content" position="popper">
              <Select.Viewport>
                {["Yes, I am authorized to work in the US", "No, I am not authorized"].map((option) => (
                  <Select.Item key={option} value={option} className="item"><Select.ItemText>{option}</Select.ItemText></Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>
      <div className="field">
        <label id="school-label">School *</label>
        <SchoolBox value={values.School ?? ""} onChange={set("School")} />
      </div>
      <fieldset className="field">
        <legend>Will you now or in the future require sponsorship? *</legend>
        {["Yes", "No"].map((option) => (
          <label key={option} style={{ marginRight: 16 }}>
            <input type="radio" name="sponsor" value={option} checked={values.sponsor === option} onChange={() => set("sponsor")(option)} /> {option}
          </label>
        ))}
      </fieldset>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(<Form />);
