import { useRequestStore } from "~/stores/request-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const methodColorClasses: Record<(typeof HTTP_METHODS)[number], string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-amber-600 dark:text-amber-400",
  PUT: "text-blue-600 dark:text-blue-400",
  PATCH: "text-purple-600 dark:text-purple-400",
  DELETE: "text-red-600 dark:text-red-400",
  HEAD: "text-zinc-600 dark:text-zinc-400",
  OPTIONS: "text-zinc-600 dark:text-zinc-400",
};

export function MethodSelector() {
  const method = useRequestStore((state) => state.method);
  const setMethod = useRequestStore((state) => state.setMethod);

  const normalizedMethod = (HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number])
    ? method
    : "GET") as (typeof HTTP_METHODS)[number];

  return (
    <Select value={normalizedMethod} onValueChange={setMethod}>
      <SelectTrigger className={cn("w-[120px] font-semibold", methodColorClasses[normalizedMethod])}>
        <SelectValue placeholder="Method" />
      </SelectTrigger>
      <SelectContent>
        {HTTP_METHODS.map((httpMethod) => (
          <SelectItem
            key={httpMethod}
            value={httpMethod}
            className={cn("font-semibold", methodColorClasses[httpMethod])}
          >
            {httpMethod}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
