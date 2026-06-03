const DC_TASK_PREFIX = "deno task dc --";

export function dcCommand(command: string): string {
  return `${DC_TASK_PREFIX} ${command}`;
}

export function dcCommandLines(commands: string[]): string[] {
  return commands.map(dcCommand);
}
