/**
 * Zet een JSON.stringify-fallback voor BigInt op process-niveau.
 *
 * Prisma geeft BigInt terug voor kolommen zoals MediaAsset.sizeBytes. Elke plek die zulke
 * rijen serialiseert (res.json(), JSON.stringify) selecteert die kolom daarom bewust niet mee
 * (zie publishing/service.ts). Deze functie is puur een tweede verdedigingslinie: als een
 * toekomstige query dat een keer vergeet, crasht de request niet met een onafgevangen
 * "Do not know how to serialize a BigInt" TypeError, maar wordt de waarde als string
 * geserialiseerd — zichtbaar fout in de response, maar geen 500 zonder duidelijke oorzaak.
 */
export function installBigIntJsonSafety(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (typeof proto.toJSON !== 'function') {
    proto.toJSON = function (this: bigint) {
      return this.toString();
    };
  }
}
