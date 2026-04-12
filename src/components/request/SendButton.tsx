import { IconLoader2, IconSend } from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import { useRequestStore } from "~/stores/request-store";

export function SendButton() {
  const isLoading = useRequestStore((state) => state.isLoading);
  const sendRequest = useRequestStore((state) => state.sendRequest);

  return (
    <Button size="lg" type="button" disabled={isLoading} onClick={() => void sendRequest()}>
      {isLoading ? (
        <>
          <IconLoader2 className="size-4 animate-spin" />
          Sending...
        </>
      ) : (
        <>
          <IconSend className="size-4" />
          Send
        </>
      )}
    </Button>
  );
}
