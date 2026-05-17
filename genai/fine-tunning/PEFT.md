What is parameter efficient fine-tuning (PEFT)?
Large language models (LLMs) require computational resources and money to operate. Parameter-efficient fine-tuning (PEFT) is a set of techniques that adjusts only a portion of parameters within an LLM to save resources.

PEFT makes LLM customization more accessible while creating outputs that are comparable to a traditional fine-tuned model.

Traditional fine-tuning vs PEFT
Fine-tuning and PEFT are both LLM alignment techniques. They adjust and inform an LLM with the data you want, to produce the output you want. You can think of PEFT as an evolution of traditional fine-tuning.

Traditional fine-tuning makes adjustments to an LLM by further training the entire model. This requires intensive computational resources, data, and time.

Comparatively, PEFT only modifies a small portion of parameters within a model, making it generally more accessible for organizations without extensive resources.
Recommended for you

From code to cloud: Building AI-ready skills with Red Hat
Watch the webinar
What are the benefits of PEFT?
PEFT provides the benefit of training large models, faster, on smaller hardware.

Specifically, benefits of PEFT include:

Faster training speed: When fewer parameters are updated, PEFT allows for quicker experimentation and iteration.
Resource-efficient: PEFT uses much less GPU memory than traditional fine-tuning and can run on consumer-grade hardware. This means you can train an LLM on a laptop rather than needing a dedicated server.
Ability to overcome catastrophic forgetting: Catastrophic forgetting happens when the model forgets the knowledge it’s already learned when provided with new training data. PEFT helps models avoid catastrophic forgetting because it only updates a few parameters rather than the whole model.
Portable: Models tuned with PEFT are smaller, more manageable, and easier to deploy across platforms. This makes the model easier to update and improve in an operational environment.
Sustainable: PEFT aligns with eco-friendly operational goals by using fewer computational resources.
Accessible: Teams and organizations with fewer computational resources can fine-tune models and still achieve a desirable result.
Explore other model enhancement techniques like Mixture of Experts
How does PEFT work?
LLMs are composed of multiple neural network layers. Think of these layers as a type of flow chart, starting with an input layer and ending with an output layer. Sandwiched between these 2 layers are many other layers, each playing a role to process data as it moves through the neural network.

If you want to adjust the way a language model processes information, you change the parameters.

PEFT technique: How to optimize LLMs with GPUs

What are parameters in an LLM?

Parameters (sometimes called weights) shape an LLM’s understanding of language.

Think of parameters like an adjustable gear within a machine. Each parameter has a specific numerical value–the shifting of which affects the model’s ability to interpret and generate language.

An LLM can contain billions (even hundreds of billions) of parameters. The more parameters a model has, the more complex the tasks it can perform.

However, as the number of parameters in a model increases, so does the need for hardware resources. Organizations may not have the means to invest in these hardware requirements, which is why tuning techniques like PEFT are so important.

To increase model efficiency, learn how to eliminate unnecessary parameters while maintaining accuracy.

Fine-tuning parameters, efficiently

PEFT strategically modifies only a small number of parameters while preserving most of the pretrained model’s structure. Some examples of ways to make these adjustments include:

Freezing model layers: During inference, calculations are sent through all the layers of a neural network. By freezing some of those layers, you cut down on some of the processing power needed to perform calculations.

Adding adapters: Think of adapters like an expansion pack for a board game. Adapters are added on top of the layers within the pre-trained model and trained to learn domain- or application-specific information. In this scenario, the original model doesn’t change, but gains new capabilities.

There are several methods used to perform PEFT, including:

LoRA (low-rank adaptation)
QLoRA (quantized low-rank adaptation)
Prefix tuning
Prompt tuning
P-tuning
Learn about LoRA vs QLoRA

A leading tool in this space is vLLM. vLLM is a memory-efficient inference server and engine, designed to improve the speed and processing power of large language models in a hybrid cloud setting. vLLM’s support for PEFT, specifically for serving multiple LoRA adapters, provides a massive efficiency boost by allowing 1 base model to remain loaded in the GPU memory.

Using vLLM to serve PEFT allows 1 model to serve multiple fine-tuned versions simultaneously. In other words, PEFT creates small files, and vLLM optimizes the serving of those files by sharing and distributing memory resources–like the key-value (KV) cache–from a singular underlying model.

Learn more about vLLM
