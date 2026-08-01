import Builder from "./Builder";

export default async function NewCharacterPage(
  props: PageProps<"/campaign/[id]/new-character">,
) {
  const { id } = await props.params;
  return <Builder campaignId={id} />;
}
