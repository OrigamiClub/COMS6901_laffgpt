"use client";

import { useFormStatus } from "react-dom";

// A submit button that asks first, for deletes and other changes that are
// hard to undo. `formAction` lets one form have both Save and Delete.
export default function ConfirmButton({
  question,
  children,
  formAction,
  className = "btn border-red-700 text-red-700 disabled:opacity-60",
}: {
  question: string;
  children: React.ReactNode;
  formAction?: (formData: FormData) => void | Promise<void>;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={formAction}
      formNoValidate
      disabled={pending}
      onClick={(e) => {
        if (!confirm(question)) e.preventDefault();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
