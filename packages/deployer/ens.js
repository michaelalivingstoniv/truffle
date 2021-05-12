const path = require("path");
const { default: ENSJS, getEnsAddress } = require("@ensdomains/ensjs");
const contract = require("@truffle/contract");
const { sha3 } = require("web3-utils");
const { hash } = require("eth-ens-namehash");

const deployENS = async ({ config, deployer, from = config.from }) => {
  const artifacts = config.resolver;
  const searchPath = path.join(config.truffle_directory, "..", "..");
  const ENS = artifacts.require("@ensdomains/ens/ENSRegistry", searchPath);
  const FIFSRegistrar = artifacts.require("@ensdomains/ens/FIFSRegistrar", searchPath);
  const PublicResolver = artifacts.require("@ensdomains/resolver/PublicResolver", searchPath);

  const nodes = {
    root: "0x0000000000000000000000000000000000000000",
    resolver: hash("resolver"),
  };

  const labels = {
    root: "",
    resolver: sha3("resolver"),
  };

  await deployer.start();

  await deployer.deploy(ENS, { from });
  const ens = await ENS.deployed();


  await deployer.deploy(PublicResolver, ens.address, { from });


  const resolver = await PublicResolver.deployed();

  await ens.setSubnodeOwner(nodes.root, labels.resolver, from, { from });
  await ens.setResolver(nodes.root, resolver.address, { from });
  await resolver.methods["setAddr(bytes32,address)"](nodes.resolver, resolver.address, { from });

  await deployer.deploy(FIFSRegistrar, ens.address, nodes.root, { from });
  const registrar = await FIFSRegistrar.deployed();

  console.debug("deployed registrar");
  await ens.setOwner(nodes.root, registrar.address, { from });
  console.debug("owner set");


  await deployer.finish();

  return {
    ens,
    resolver
  };
};

class ENS {
  constructor({ config, deployer, ensSettings }) {
    this.ensSettings = ensSettings;
    this.provider = config.provider;
    this.config = config;
    this.deployer = deployer;
    this.networkId = config.network_id;
    this.devRegistry = null;
    this.ens = null;
  }

  // get registryAddress() {
  //   return this.ensSettings.registryAddress || getEnsAddress(this.networkId);
  // }

  async prepareENS(from) {
    const { ens, resolver } = await deployENS({
      config: this.config,
      deployer: this.deployer,
      from
    });

    this.ensSettings.registryAddress = ens.address;
    this.ens = new ENSJS({
      provider: this.provider,
      ensAddress: ens.address
    });
    this.resolver = resolver;
    return ens;
  }

  async ensureRegistryExists(from) {
    if (!this.ens) {
      await this.prepareENS(from);
    }
    // // See if registry exists on network by resolving an arbitrary address
    // // If no registry exists then deploy one
    // try {
    //   await this.ensjs.owner("0x0");
    // } catch (error) {
    //   const noRegistryFound =
    //     error.message ===
    //     "This contract object doesn't have address set yet, please set an address first.";
    //   if (noRegistryFound) {
    //     await this.deployNewDevENSRegistry(from);
    //   } else {
    //     throw error;
    //   }
    // }
  }

  // async ensureResolverExists({ from, name }) {
  //   // See if the resolver is set, if not then set it
  //   let resolvedAddress, publicResolver;
  //   try {
  //     resolvedAddress = await this.ens.name(name).getAddress("ETH");
  //     return { resolvedAddress };
  //   } catch (error) {
  //     if (error.message !== "ENS name not found") throw error;
  //     const PublicResolverArtifact = require("@ensdomains/resolver")
  //       .PublicResolver;
  //     const PublicResolver = contract(PublicResolverArtifact);
  //     PublicResolver.setProvider(this.provider);

  //     let registryAddress = this.determineENSRegistryAddress();

  //     publicResolver = await PublicResolver.new(registryAddress, { from });
  //     const tx = await this.ens.name(name)
  //       .setResolver(publicResolver.address, { from });
  //     await tx.wait();
  //     return { resolvedAddress: null };
  //   }
  // }

  async setAddress(name, addressOrContract, { from }) {
    this.validateSetAddressInputs({ addressOrContract, name, from });
    const address = this.parseAddress(addressOrContract);
    await this.ensureRegistryExists(from);

    await this.setNameOwner({ from, name });

    // Find the owner of the name and compare it to the "from" field
    const nameOwner = await this.ens.name(name).getOwner();

    if (nameOwner !== from) {
      const message =
        `The default address or address provided in the "from" ` +
        `field for registering does not own the specified ENS name. The ` +
        `"from" field address must match the owner of the name.` +
        `\n> Failed to register ENS name ${name}` +
        `\n> Address in "from" field - ${from}` +
        `\n> Current owner of '${name}' - ${nameOwner}`;
      throw new Error(message);
    }

    const resolvedAddress = await this.ens.name(name).getAddress("ETH");

    const hasResolver = (await this.ens.name(name).getResolver())
      .slice(2)
      .split("")
      .filter(char => char !== "0")
      .length > 0;

    if (!hasResolver) {
      const tx = await this.ens.name(name)
        .setResolver(this.resolver.address, { from });
      await tx.wait();
    }

    // const { resolvedAddress } = await this.ensureResolverExists({ from, name });
    // If the resolver points to a different address or is not set,
    // then set it to the specified address
    if (resolvedAddress !== address) {
      const tx = await this.ens.name(name).setAddress("ETH", address, { from });
      await tx.wait();
    }
  }

  async setNameOwner({ name, from }) {
    const labels = name.split(".").reverse();;

    const current = [];
    for (const label of labels) {
      console.debug("label %s", label);
      const tx = await this.ens.name(current.join("."))
        .setSubnodeOwner(label, from, { from });
      await tx.wait();

      current.unshift(label);
    }

    // const sequence = labels
    //   .map((_, index) => labels.slice(0, index + 1).join("."))
    //   .reverse();

    // const tld = sequence[0];
    // await this.ens.name("").setSubnodeOwner(tld, from, { from });
    // for (const name of sequence.slice(1)) {
    //   await this.ens.name(name).setOwner(from, { from });
    // }



    // // Set top-level name
    // let builtName = nameLabels[0];
    // // await this.devRegistry.setSubnodeOwner("0x0", sha3(builtName), from, {
    // //   from
    // // });

    // // If name is only one label, stop here
    // if (nameLabels.length === 1) return;

    // for (const label of nameLabels.slice(1)) {
    //   await this.devRegistry.setSubnodeOwner(
    //     hash(builtName),
    //     sha3(label),
    //     from,
    //     { from }
    //   );
    //   builtName = label.concat(`.${builtName}`);
    // }
  }

  parseAddress(addressOrContract) {
    if (typeof addressOrContract === "string") return addressOrContract;
    try {
      return addressOrContract.address;
    } catch (error) {
      const message =
        `You have not entered a valid address or contract ` +
        `object with an address property. Please ensure that you enter a ` +
        `valid address or pass in a valid artifact.`;
      throw new Error(message);
    }
  }

  validateSetAddressInputs({ addressOrContract, name, from }) {
    if (
      !addressOrContract ||
      !name ||
      !from ||
      (typeof addressOrContract !== "string" &&
        typeof addressOrContract !== "object") ||
      typeof name !== "string" ||
      typeof from !== "string"
    ) {
      const message =
        `The 'address', 'name', or 'from' parameter is invalid for ` +
        `the call to the setAddress function. Please ensure that you are ` +
        `passing valid values. The received input values were the ` +
        `following:\n   - address: ${addressOrContract}\n   - name: ${name}\n   - from: ` +
        `${from}\n`;
      throw new Error(message);
    }
  }
}

module.exports = ENS;
