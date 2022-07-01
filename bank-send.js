const { cosmosclient } = require("@cosmos-client/core");

function bankSend(properties, context) {
  //Load any data
  const chainID = properties.chainId;
  const restURL = properties.rest;
  const websocketURL = properties.websocket;
  const restApi = new cosmosclient.CosmosSDK(restURL, chainID);
  const websocketApi = new cosmosclient.CosmosSDK(websocketURL, chainID);
  const sdk = { rest: restApi, websocket: websocketApi };
  const bech32Prefix = properties.bech32Prefix;
  cosmosclient.config.setBech32Prefix({
    accAddr: bech32Prefix,
    accPub: bech32Prefix + cosmosclient.AddressPrefix.Public,
    valAddr:
      bech32Prefix +
      cosmosclient.AddressPrefix.Validator +
      cosmosclient.AddressPrefix.Operator,
    valPub:
      bech32Prefix +
      cosmosclient.AddressPrefix.Validator +
      cosmosclient.AddressPrefix.Operator +
      cosmosclient.AddressPrefix.Public,
    consAddr:
      bech32Prefix +
      cosmosclient.AddressPrefix.Validator +
      cosmosclient.AddressPrefix.Consensus,
    consPub:
      bech32Prefix +
      cosmosclient.AddressPrefix.Validator +
      cosmosclient.AddressPrefix.Consensus +
      cosmosclient.AddressPrefix.Public,
  });
  const fromHexString = (hexString) =>
    Uint8Array.from(
      hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
    );
  const toHexString = (bytes) =>
    bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

  const fromPubKey = fromHexString(properties.fromrPubKey);
  const fromAddress = cosmosclient.AccAddress.fromString(
    properties.fromAddress
  );
  const pubKey = new cosmosclient.proto.cosmos.crypto.secp256k1.PubKey({
    key: fromPubKey,
  });
  const toAddress = cosmosclient.AccAddress.fromString(properties.toAddress);

  //Do the operation
  context.async(async (callback) => {
    try {
      const account = await cosmosclient.rest.auth
        .account(sdk, fromAddress)
        .then((res) =>
          cosmosclient.codec.protoJSONToInstance(
            cosmosclient.codec.castProtoJSONOfProtoAny(res.data.account)
          )
        )
        .catch((_) => undefined);

      if (
        !(account instanceof cosmosclient.proto.cosmos.auth.v1beta1.BaseAccount)
      ) {
        console.log(account);
        return;
      }

      const msg = new cosmosclient.proto.cosmos.bank.v1beta1.MsgSend({
        from_address: fromAddress.toString(),
        to_address: toAddress.toString(),
        amount: [{ denom: properties.denom, amount: properties.amount }],
      });

      const txBody = new cosmosclient.proto.cosmos.tx.v1beta1.TxBody({
        messages: [cosmosclient.codec.instanceToProtoAny(msg)],
      });

      const authInfo = new cosmosclient.proto.cosmos.tx.v1beta1.AuthInfo({
        signer_infos: [
          {
            public_key: cosmosclient.codec.instanceToProtoAny(pubKey),
            mode_info: {
              single: {
                mode: proto.cosmos.tx.signing.v1beta1.SignMode.SIGN_MODE_DIRECT,
              },
            },
            sequence: account.sequence,
          },
        ],
        fee: {
          gas_limit: Long.fromString("200000"),
        },
      });

      const txBuilder = new cosmosclient.TxBuilder(sdk, txBody, authInfo);

      const signDoc = txBuilder.signDoc(account.account_number);

      // signWithKeplr
      if (!window.keplr) {
        alert("Please install keplr extension");
        return;
      }

      const bodyBytes = signDoc.body_bytes;
      const authInfoBytes = signDoc.auth_info_bytes;
      const accountNumber = account.account_number;

      await window.keplr.enable(properties.chainId);
      const directSignResponse = await window.keplr.signDirect(
        chainID,
        fromAddress,
        {
          bodyBytes,
          authInfoBytes,
          chainId,
          accountNumber,
        }
      );
      txBuilder.txRaw.auth_info_bytes = directSignResponse.signed.authInfoBytes;
      txBuilder.txRaw.body_bytes = directSignResponse.signed.bodyBytes;
      txBuilder.addSignature(
        Uint8Array.from(
          Buffer.from(directSignResponse.signature.signature, "base64")
        )
      );

      const result = await cosmosclient.rest.tx.broadcastTx(sdk.rest, {
        tx_bytes: txBuilder.txBytes(),
        mode: cosmosclient.rest.tx.BroadcastTxMode.Block,
      });

      if (result.data.tx_response?.code !== 0) {
        console.error(result.data.tx_response?.raw_log);
      }

      const ret = result.data;

      // old comment
      // const ret = {
      //   bodyBytes: toHexString(signDoc.body_bytes),
      //   authInfoBytes: toHexString(signDoc.auth_info_bytes),
      //   chainId: signDoc.chain_id,
      //   accountNumber: signDoc.account_number,
      // };
      callback(null, ret);
    } catch (err) {
      callback(err);
    }
  });
}
