export const dynamic = 'force-dynamic';

export default function CspProbe() {
  return (
    <div
      dangerouslySetInnerHTML={{
        __html:
          '<script>window.__inlineOk=1</script><button id="attr-btn" onclick="window.__attrOk=1">attr</button>',
      }}
    />
  );
}
