import type { Employee } from '../types';

interface Props {
  employees: Employee[];
  selected: Set<string>;
  all: boolean;
  onToggle: (username: string) => void;
  onAllChange: (all: boolean) => void;
}

export function AssignmentPicker({ employees, selected, all, onToggle, onAllChange }: Props) {
  return (
    <div className="bio-form__assign">
      <span className="cred-field__label">Assign to</span>
      <label className="bio-check">
        <input type="checkbox" checked={all} onChange={(e) => onAllChange(e.target.checked)} />
        All employees
      </label>
      {!all && (
        <div className="bio-employees">
          {employees.length === 0 ? (
            <span className="cred-note">No employees yet.</span>
          ) : (
            employees.map((employee) => (
              <label key={employee.username} className="bio-check">
                <input
                  type="checkbox"
                  checked={selected.has(employee.username)}
                  onChange={() => onToggle(employee.username)}
                />
                {employee.username}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
