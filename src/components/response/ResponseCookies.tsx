import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useActiveTabField } from "~/hooks/useActiveTab";

interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

const EMPTY_VALUE = "—";

const parseSetCookie = (headerValue: string): ParsedCookie => {
  const parts = headerValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const [nameValue = "", ...attributes] = parts;
  const separatorIndex = nameValue.indexOf("=");
  const name = separatorIndex >= 0 ? nameValue.slice(0, separatorIndex) : nameValue;
  const value = separatorIndex >= 0 ? nameValue.slice(separatorIndex + 1) : "";

  const parsed: ParsedCookie = {
    name,
    value,
    domain: "",
    path: "",
    expires: "",
    secure: false,
    httpOnly: false,
    sameSite: "",
  };

  for (const attribute of attributes) {
    const [rawKey, ...rawValue] = attribute.split("=");
    const key = rawKey.trim().toLowerCase();
    const attributeValue = rawValue.join("=").trim();

    switch (key) {
      case "domain":
        parsed.domain = attributeValue;
        break;
      case "path":
        parsed.path = attributeValue;
        break;
      case "expires":
        parsed.expires = attributeValue;
        break;
      case "samesite":
        parsed.sameSite = attributeValue;
        break;
      case "secure":
        parsed.secure = true;
        break;
      case "httponly":
        parsed.httpOnly = true;
        break;
      default:
        break;
    }
  }

  return parsed;
};

function BooleanCell({ value }: { value: boolean }) {
  return <span className="font-medium">{value ? "✓" : EMPTY_VALUE}</span>;
}

function ValueCell({ value }: { value: string }) {
  if (!value) {
    return <span>{EMPTY_VALUE}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block truncate font-mono text-foreground">{value}</span>
      </TooltipTrigger>
      <TooltipContent sideOffset={4} className="max-w-md break-all font-mono">
        {value}
      </TooltipContent>
    </Tooltip>
  );
}

export function ResponseCookies() {
  const response = useActiveTabField("response", null);
  const cookies = (response?.headers ?? [])
    .filter((header) => header.key.trim().toLowerCase() === "set-cookie")
    .map((header) => parseSetCookie(header.value));

  if (cookies.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
        No cookies in this response.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-full overflow-auto rounded-md border border-border">
        <div className="grid min-w-[960px] grid-cols-[160px_minmax(220px,1.6fr)_140px_120px_220px_90px_100px_110px] border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Name</span>
          <span>Value</span>
          <span>Domain</span>
          <span>Path</span>
          <span>Expires</span>
          <span>Secure</span>
          <span>HttpOnly</span>
          <span>SameSite</span>
        </div>

        <div className="divide-y divide-border text-sm">
          {cookies.map((cookie, index) => (
            <div
              key={`${cookie.name}-${index}`}
              className="grid min-w-[960px] grid-cols-[160px_minmax(220px,1.6fr)_140px_120px_220px_90px_100px_110px] items-start gap-3 px-3 py-2"
            >
              <span className="font-mono text-foreground">{cookie.name || EMPTY_VALUE}</span>
              <ValueCell value={cookie.value} />
              <span className="font-mono break-all">{cookie.domain || EMPTY_VALUE}</span>
              <span className="font-mono break-all">{cookie.path || EMPTY_VALUE}</span>
              <span className="font-mono break-all">{cookie.expires || EMPTY_VALUE}</span>
              <BooleanCell value={cookie.secure} />
              <BooleanCell value={cookie.httpOnly} />
              <span className="font-mono break-all">{cookie.sameSite || EMPTY_VALUE}</span>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
