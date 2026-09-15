declare module 'mapshaper' {
  const mapshaper: {
    applyCommands(commands: string, input: Record<string, string>): Promise<Record<string, string>>;
  };
  export default mapshaper;
}
