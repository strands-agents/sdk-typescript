use crate::message::ToolResult;

#[derive(Clone, Debug, Default)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct Property {
    pub key: String,
    pub description: Option<String>,
    pub property_type: Option<String>,
    pub required: bool,
}

#[derive(Clone, Debug, Default)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ToolSpec {
    pub name: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub input_schema: Option<Vec<Property>>,
}

pub struct ToolContext;

#[async_trait::async_trait]
pub trait Tool<E> {
    fn spec(&self) -> ToolSpec;

    async fn invoke(
        &self,
        _input: &serde_json::Map<String, serde_json::Value>,
        context: &ToolContext,
    ) -> Result<ToolResult, E>;

    fn boxed(self) -> Box<dyn Tool<E>>
    where
        Self: Sized + 'static,
    {
        Box::new(self)
    }
}
