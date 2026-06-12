export interface Assignable {
  employees?: string[];
  allEmployees?: boolean;
  employee?: string;
}

/** True if an assignable item (license/proxy/bio/cta) applies to the given employee. */
export function matchesEmployee(item: Assignable, username: string): boolean {
  if (item.allEmployees) return true;
  if (item.employees && item.employees.includes(username)) return true;
  if (item.employee && item.employee === username) return true;
  return false;
}

/** Normalized list of employees an item is assigned to (excluding the "all" case). */
export function assignedEmployees(item: Assignable): string[] {
  if (item.employees && item.employees.length > 0) return item.employees;
  if (item.employee) return [item.employee];
  return [];
}
