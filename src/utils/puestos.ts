export function referenciaPuesto(id: string): string {
  return id.slice(0, 8).toLocaleUpperCase('en-US');
}
