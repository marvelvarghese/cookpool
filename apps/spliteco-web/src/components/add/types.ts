import type { ExpenseForm } from "../../lib/split-form";
import type { Names } from "../../lib/people";

/** What every view of the Add expense form shares. */
export interface FormCtx {
  form: ExpenseForm;
  setForm: (f: ExpenseForm | ((f: ExpenseForm) => ExpenseForm)) => void;
  names: Names;
  me: string | null;
  currency: string;
}
