export function errorText(value: unknown): string {
   const message = value instanceof Error ? value.message : String(value);
   if (/reply was never sent/i.test(message)) {
      const channel = /remote method '([^']+)'/.exec(message)?.[1];
      const action = channel?.startsWith("export:")
         ? "The export request"
         : channel === "directory:choose" || channel === "source:choose"
           ? "The file picker"
           : "The request";
      return `${action} did not receive a response from AttaCut. Try again. If it keeps happening, restart AttaCut.`;
   }
   return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
