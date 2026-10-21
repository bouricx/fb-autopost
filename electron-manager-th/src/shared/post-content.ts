/** Main editor is the only source for original posts. Follow-up content is independent. */
export function mainPostContent(input: { caption: string; media: string[] }) {
  return { caption: input.caption, media: [...input.media] };
}
