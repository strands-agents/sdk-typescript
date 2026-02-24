use std::collections::HashMap;

pub trait StateProvider: std::fmt::Debug {}

impl<K, V> StateProvider for HashMap<K, V>
where
    K: std::fmt::Debug,
    V: std::fmt::Debug,
{
}
