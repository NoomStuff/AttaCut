export function explainExportError(message: string | null): string {
   if (!message) return "The file could not be exported.";
   if (/automatic conversion is disabled|do not have a common format/i.test(message))
      return "AttaCut could not encode this cut with the video's color format. Try a nearby cut or turn on Snap to keyframes.";
   if (/ENOSPC|No space left on device/i.test(message)) return "The destination drive is full. Free some space or choose another folder.";
   if (/EACCES|EPERM|Permission denied|Access is denied/i.test(message))
      return "AttaCut could not write to this folder. Choose another folder or check its permissions.";
   if (/Input buffer exhausted|Error while decoding|Invalid data found when processing input/i.test(message))
      return "AttaCut could not read the video cleanly near this cut. Try a nearby cut or check the source video.";
   if (
      !message.includes("\n") &&
      message.length < 300 &&
      /^(The (original|export|exported|selected)|This (file|cut|selection)|Precise |Choose |Confirm |An (output|encoded)|Some clips|One or more|Cannot access|Could not verify|No video|Trimming |Cutting |Preserving )/i.test(
         message
      )
   )
      return message;
   return "AttaCut could not finish this file. Try a nearby cut, then check the technical details if it fails again.";
}
